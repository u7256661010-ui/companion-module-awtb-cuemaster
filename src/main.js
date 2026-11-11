// Bitfocus Companion module for CueMaster.
// Connects to CueMaster's WebSocket (Options > Remote control), sends commands as short text lines and
// receives tile labels and playback state. One connection, reconnect with back-off, no polling.

const { InstanceBase, runEntrypoint, InstanceStatus, combineRgb, Regex } = require('@companion-module/base')
const WebSocket = require('ws')
const L = require('./logic.js')

const BANK_CHOICES = [{ id: 'current', label: 'Active bank' }, ...L.LETTERS.map((l) => ({ id: l, label: `Bank ${l}` }))]
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 170, 60)
const ORANGE = combineRgb(230, 140, 0)
const GREY = combineRgb(40, 40, 40)
// PFL / edit mode: the amber CueMaster uses for PFL in its routing matrix.
const AMBER = combineRgb(240, 180, 0)

const bankOpt = { type: 'dropdown', id: 'bank', label: 'Bank', default: 'current', choices: BANK_CHOICES }
const cueOpt = { type: 'number', id: 'cue', label: 'Tile (1–40)', default: 1, min: 1, max: L.MAX_CUES }
const msOpt = { type: 'number', id: 'ms', label: 'Fade time in ms (0 = CueMaster setting)', default: 0, min: 0, max: 60000 }

class CueMasterInstance extends InstanceBase {
	async init(config) {
		this.config = config
		this.labels = { gen: -1, banks: [] }
		this.state = null
		this.vars = {}
		this.blinkOn = true
		this.retry = 1000
		this.setActionDefinitions(this.actions())
		this.setFeedbackDefinitions(this.feedbacks())
		this.defineVariables()
		// Presets sofort anbieten, auch wenn CueMaster noch nicht erreichbar ist; Namen und Farben kommen über
		// Variablen und Feedbacks, sobald die Verbindung steht.
		this.definePresets()
		this.connect()
	}

	async destroy() {
		this.closed = true
		this.disconnect()
	}

	async configUpdated(config) {
		this.config = config
		this.retry = 1000
		this.disconnect()
		this.connect()
	}

	getConfigFields() {
		return [
			{ type: 'static-text', id: 'info', width: 12, label: '', value: 'In CueMaster open Settings > "Stream Deck, Companion, OSC …" and turn on "Companion and Stream Deck". Use 127.0.0.1 if Companion runs on the same PC; otherwise also enable "Reachable from the network" there and enter the address CueMaster shows.' },
			{ type: 'textinput', id: 'host', label: 'CueMaster PC (IP or name)', width: 8, default: '127.0.0.1' },
			{ type: 'number', id: 'port', label: 'Port', width: 4, default: 8088, min: 1, max: 65535 },
			{ type: 'checkbox', id: 'blink', label: 'Blink buttons of playing cues', width: 6, default: true },
		]
	}

	// ---------------------------------------------------------------- connection

	connect() {
		if (this.closed) return
		const host = (this.config.host || '127.0.0.1').trim()
		const port = Number(this.config.port) || 8088
		this.updateStatus(InstanceStatus.Connecting)
		let ws
		try {
			ws = new WebSocket(`ws://${host}:${port}/ws`, { handshakeTimeout: 4000, perMessageDeflate: false, maxPayload: 1 << 20 })
		} catch (e) {
			this.updateStatus(InstanceStatus.BadConfig, String(e.message || e))
			return
		}
		this.ws = ws
		ws.on('open', () => {
			this.retry = 1000
			this.updateStatus(InstanceStatus.Ok)
		})
		ws.on('message', (data) => this.onMessage(data))
		ws.on('error', (e) => {
			this.log('debug', `CueMaster: ${e.message}`)
		})
		ws.on('close', () => {
			if (this.ws !== ws) return
			this.ws = null
			this.state = null
			this.applyState()
			if (this.closed) return
			this.updateStatus(InstanceStatus.ConnectionFailure, 'CueMaster not reachable')
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = setTimeout(() => this.connect(), this.retry)
			this.retry = Math.min(this.retry * 2, 10000)
		})
	}

	disconnect() {
		clearTimeout(this.reconnectTimer)
		this.stopBlink()
		if (this.ws) {
			const ws = this.ws
			this.ws = null
			ws.removeAllListeners()
			ws.on('error', () => {})
			try {
				ws.terminate()
			} catch (e) {
				// already closed
			}
		}
	}

	send(cmd) {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(cmd)
		} else {
			this.log('warn', `CueMaster not connected, "${cmd}" not sent`)
		}
	}

	onMessage(data) {
		let msg
		try {
			msg = JSON.parse(data.toString())
		} catch (e) {
			return
		}
		if (msg.type === 'labels') {
			this.labels = msg
			this.defineVariables()
			this.definePresets()
			this.applyState()
			this.checkFeedbacks('cue_color', 'bank_color')
		} else if (msg.type === 'state') {
			const bankChanged = this.state?.bank !== msg.bank
			this.state = msg
			this.applyState()
			if (bankChanged) this.checkFeedbacks('cue_color')
		} else if (msg.type === 'error') {
			this.log('warn', `CueMaster: ${msg.error} (${msg.command})`)
		}
	}

	applyState() {
		const next = L.variableValues(this.labels, this.state)
		const diff = L.changed(this.vars, next)
		this.vars = next
		if (Object.keys(diff).length) this.setVariableValues(diff)
		this.checkFeedbacks('cue_state', 'bank_active', 'cue_focus', 'cue_pfl', 'edit_mode')
		const anyPlaying = (this.state?.cues ?? []).some((c) => c.state === 'playing')
		if (anyPlaying && this.config.blink !== false) this.startBlink()
		else this.stopBlink()
	}

	// Blink timer only runs while something plays.
	startBlink() {
		if (this.blinkTimer) return
		this.blinkTimer = setInterval(() => {
			this.blinkOn = !this.blinkOn
			this.checkFeedbacks('cue_state')
		}, 500)
	}

	stopBlink() {
		if (!this.blinkTimer) return
		clearInterval(this.blinkTimer)
		this.blinkTimer = null
		this.blinkOn = true
	}

	// ---------------------------------------------------------------- definitions

	cueIndex(opt) {
		const letter = L.resolveBank(opt.bank, this.state)
		return { letter, b: L.bankIndex(letter), c: Math.floor(Number(opt.cue) || 1) - 1 }
	}

	actions() {
		const cueAction = (name, verb, extra = []) => ({
			name,
			options: [bankOpt, cueOpt, ...extra],
			callback: (ev) => {
				const { letter } = this.cueIndex(ev.options)
				this.send(L.cueCommand(letter, ev.options.cue, verb, ev.options.ms))
			},
		})
		const simple = (name, cmd) => ({ name, options: [], callback: () => this.send(cmd) })
		return {
			cue_press: cueAction('Cue: press tile (like a click)', ''),
			cue_stop: cueAction('Cue: stop', 'stop'),
			cue_fade: cueAction('Cue: fade out', 'fade', [msOpt]),
			cue_select: cueAction('Cue: select in player', 'select'),
			bank_select: {
				name: 'Bank: select',
				options: [{ type: 'dropdown', id: 'bank', label: 'Bank', default: 'A', choices: [...L.LETTERS.map((l) => ({ id: l, label: `Bank ${l}` })), { id: 'next', label: 'Next bank' }, { id: 'prev', label: 'Previous bank' }] }],
				callback: (ev) => this.send(`bank/${ev.options.bank}`),
			},
			player_stop: simple('Player: stop', 'stop'),
			player_fade: { name: 'Player: fade out', options: [msOpt], callback: (ev) => this.send(Number(ev.options.ms) > 0 ? `fade ${ev.options.ms}` : 'fade') },
			player_pause: simple('Player: pause / resume', 'pause'),
			player_rewind: simple('Player: back to start', 'rewind'),
			player_skip: {
				name: 'Player: skip seconds',
				options: [{ type: 'number', id: 'secs', label: 'Seconds (negative = back)', default: 5, min: -600, max: 600 }],
				callback: (ev) => this.send(`skip ${Number(ev.options.secs) || 0}`),
			},
			stop_all: simple('Stop all', 'stopall'),
			panic: simple('Panic (silence within 150 ms)', 'panic'),
			show_end: simple('Show end now (fade out and stop everything)', 'showend'),
		}
	}

	feedbacks() {
		return {
			cue_color: {
				type: 'advanced',
				name: 'Cue: tile colour and name from CueMaster',
				options: [bankOpt, cueOpt, { type: 'checkbox', id: 'text', label: 'Also show the tile name', default: false }],
				callback: (fb) => {
					const { b, c } = this.cueIndex(fb.options)
					const cue = this.labels.banks[b]?.cues?.[c]
					if (!cue) return {}
					const out = {}
					const col = L.parseColor(cue.color) ?? L.parseColor(this.labels.banks[b]?.color)
					if (col !== null) {
						out.bgcolor = col
						out.color = L.textColor(col)
					}
					if (fb.options.text) out.text = cue.name
					return out
				},
			},
			cue_state: {
				type: 'boolean',
				name: 'Cue: is playing / paused / fading',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [
					bankOpt,
					cueOpt,
					{ type: 'dropdown', id: 'state', label: 'State', default: 'active', choices: [{ id: 'active', label: 'Playing, paused, fading or starting' }, { id: 'playing', label: 'Playing' }, { id: 'paused', label: 'Paused' }, { id: 'stopping', label: 'Fading out' }, { id: 'starting', label: 'Starting' }] },
					{ type: 'checkbox', id: 'blink', label: 'Blink while playing', default: true },
				],
				callback: (fb) => {
					const { b, c } = this.cueIndex(fb.options)
					const run = L.findCue(this.state, b, c)
					if (!run) return false
					const match = fb.options.state === 'active' || fb.options.state === run.state
					if (!match) return false
					if (fb.options.blink && run.state === 'playing' && this.config.blink !== false) return this.blinkOn
					return true
				},
			},
			cue_pfl: {
				type: 'boolean',
				name: 'Cue: is pre-listened in edit mode (PFL)',
				defaultStyle: { bgcolor: AMBER, color: BLACK },
				options: [bankOpt, cueOpt],
				callback: (fb) => {
					const { b, c } = this.cueIndex(fb.options)
					return !!L.findPfl(this.state, b, c)
				},
			},
			edit_mode: {
				type: 'boolean',
				name: 'CueMaster is in edit mode',
				defaultStyle: { bgcolor: AMBER, color: BLACK },
				options: [],
				callback: () => this.state?.mode === 'edit',
			},
			cue_focus: {
				type: 'boolean',
				name: 'Cue: is selected in the player',
				defaultStyle: { color: combineRgb(255, 220, 0) },
				options: [bankOpt, cueOpt],
				callback: (fb) => {
					const { b, c } = this.cueIndex(fb.options)
					const f = this.state?.focus ?? this.state?.armed
					return !!f && f[0] === b && f[1] === c
				},
			},
			bank_color: {
				type: 'advanced',
				name: 'Bank: colour from CueMaster',
				options: [{ type: 'dropdown', id: 'bank', label: 'Bank', default: 'A', choices: L.LETTERS.map((l) => ({ id: l, label: `Bank ${l}` })) }],
				callback: (fb) => {
					const col = L.parseColor(this.labels.banks[L.bankIndex(fb.options.bank)]?.color)
					return col === null ? {} : { bgcolor: col, color: L.textColor(col) }
				},
			},
			bank_active: {
				type: 'boolean',
				name: 'Bank: is active',
				defaultStyle: { bgcolor: ORANGE, color: BLACK },
				options: [{ type: 'dropdown', id: 'bank', label: 'Bank', default: 'A', choices: L.LETTERS.map((l) => ({ id: l, label: `Bank ${l}` })) }],
				callback: (fb) => this.state?.bank === L.bankIndex(fb.options.bank),
			},
		}
	}

	defineVariables() {
		const defs = [
			{ variableId: 'active_bank', name: 'Active bank (letter)' },
			{ variableId: 'active_bank_name', name: 'Active bank name' },
			{ variableId: 'focus_name', name: 'Player: cue name' },
			{ variableId: 'focus_cue', name: 'Player: cue (e.g. A3)' },
			{ variableId: 'focus_remaining', name: 'Player: remaining time' },
			{ variableId: 'focus_elapsed', name: 'Player: elapsed time' },
			{ variableId: 'playing_count', name: 'Number of playing cues (show)' },
			{ variableId: 'mode', name: 'Mode on the PC (SHOW or EDIT)' },
			{ variableId: 'pfl_name', name: 'PFL: name of the pre-listened cue' },
			{ variableId: 'pfl_cue', name: 'PFL: pre-listened cue (e.g. A3)' },
			{ variableId: 'pfl_remaining', name: 'PFL: remaining time' },
			...L.LETTERS.map((l) => ({ variableId: `bank_${l}_name`, name: `Bank ${l}: name` })),
		]
		for (let ci = 1; ci <= L.MAX_CUES; ci++) {
			defs.push({ variableId: `current_${ci}_name`, name: `Active bank tile ${ci}: name` })
			defs.push({ variableId: `current_${ci}_state`, name: `Active bank tile ${ci}: state` })
			defs.push({ variableId: `current_${ci}_remaining`, name: `Active bank tile ${ci}: remaining` })
		}
		this.labels.banks.forEach((bank, bi) => {
			bank.cues.forEach((_, ci) => {
				const id = `${L.LETTERS[bi]}_${ci + 1}`
				defs.push({ variableId: `cue_${id}_name`, name: `${id.replace('_', '')}: name` })
				defs.push({ variableId: `cue_${id}_state`, name: `${id.replace('_', '')}: state` })
				defs.push({ variableId: `cue_${id}_remaining`, name: `${id.replace('_', '')}: remaining` })
			})
		})
		this.setVariableDefinitions(defs)
		this.vars = {}
	}

	definePresets() {
		const p = {}
		const tile = (category, bank, ci, nameVar, remVar) => ({
			type: 'button',
			category,
			name: `${bank === 'current' ? 'Tile' : bank} ${ci + 1}`,
			style: { text: `$(${this.label}:${nameVar})\n$(${this.label}:${remVar})`, size: 'auto', color: WHITE, bgcolor: GREY },
			steps: [{ down: [{ actionId: 'cue_press', options: { bank, cue: ci + 1 } }], up: [] }],
			feedbacks: [
				{ feedbackId: 'cue_color', options: { bank, cue: ci + 1, text: false } },
				// Amber = pre-listened on PFL in edit mode; the show state (green) comes last and wins.
				{ feedbackId: 'cue_pfl', options: { bank, cue: ci + 1 }, style: { bgcolor: AMBER, color: BLACK } },
				{ feedbackId: 'cue_state', options: { bank, cue: ci + 1, state: 'active', blink: true }, style: { bgcolor: GREEN, color: WHITE } },
			],
		})
		// Active bank (follows bank switching)
		for (let ci = 0; ci < L.MAX_CUES; ci++) {
			p[`current_${ci + 1}`] = tile('Active bank tiles', 'current', ci, `current_${ci + 1}_name`, `current_${ci + 1}_remaining`)
		}
		const banks = this.labels.banks.length ? this.labels.banks : L.LETTERS.map((l) => ({ letter: l, name: '', color: null, cues: [] }))
		banks.forEach((bank, bi) => {
			const letter = L.LETTERS[bi]
			bank.cues.forEach((_, ci) => {
				p[`cue_${letter}_${ci + 1}`] = tile(`Bank ${letter}${bank.name ? ` – ${bank.name}` : ''}`, letter, ci, `cue_${letter}_${ci + 1}_name`, `cue_${letter}_${ci + 1}_remaining`)
			})
			p[`bank_${letter}`] = {
				type: 'button',
				category: 'Banks',
				name: `Bank ${letter}`,
				style: { text: `${letter}\n$(${this.label}:bank_${letter}_name)`, size: 'auto', color: WHITE, bgcolor: GREY },
				steps: [{ down: [{ actionId: 'bank_select', options: { bank: letter } }], up: [] }],
				feedbacks: [
					{ feedbackId: 'bank_color', options: { bank: letter } },
					{ feedbackId: 'bank_active', options: { bank: letter }, style: { bgcolor: ORANGE, color: BLACK } },
				],
			}
		})
		for (const [id, name, bank] of [['bank_prev', '◀ Bank', 'prev'], ['bank_next', 'Bank ▶', 'next']]) {
			p[id] = { type: 'button', category: 'Banks', name, style: { text: name, size: 'auto', color: WHITE, bgcolor: GREY }, steps: [{ down: [{ actionId: 'bank_select', options: { bank } }], up: [] }], feedbacks: [] }
		}
		const transport = [
			['player_stop', 'STOP', {}, combineRgb(150, 0, 0)],
			['player_fade', 'FADE', { ms: 0 }, combineRgb(120, 60, 0)],
			['player_pause', 'PAUSE', {}, GREY],
			['player_rewind', '⏮', {}, GREY],
			['stop_all', 'STOP\nALL', {}, combineRgb(150, 0, 0)],
			['panic', 'PANIC', {}, combineRgb(200, 0, 0)],
		]
		for (const [action, text, options, bg] of transport) {
			p[action] = { type: 'button', category: 'Player', name: text.replace('\n', ' '), style: { text, size: 'auto', color: WHITE, bgcolor: bg }, steps: [{ down: [{ actionId: action, options }], up: [] }], feedbacks: [] }
		}
		p.player_info = {
			type: 'button',
			category: 'Player',
			name: 'Now playing',
			style: { text: `$(${this.label}:focus_name)\n$(${this.label}:focus_remaining)`, size: 'auto', color: WHITE, bgcolor: BLACK },
			steps: [{ down: [{ actionId: 'player_pause', options: {} }], up: [] }],
			feedbacks: [],
		}
		p.mode_info = {
			type: 'button',
			category: 'Player',
			name: 'Mode (show / edit)',
			style: { text: `$(${this.label}:mode)`, size: 'auto', color: WHITE, bgcolor: combineRgb(0, 90, 30) },
			steps: [{ down: [], up: [] }],
			feedbacks: [{ feedbackId: 'edit_mode', options: {}, style: { bgcolor: AMBER, color: BLACK } }],
		}
		p.pfl_info = {
			type: 'button',
			category: 'Player',
			name: 'PFL (pre-listening in edit mode)',
			style: { text: `PFL\n$(${this.label}:pfl_name)\n$(${this.label}:pfl_remaining)`, size: 'auto', color: AMBER, bgcolor: BLACK },
			steps: [{ down: [], up: [] }],
			feedbacks: [],
		}
		this.setPresetDefinitions(p)
	}
}

runEntrypoint(CueMasterInstance, [])
