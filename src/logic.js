// Pure helpers (no Companion, no network) so they can be unit-tested with `node --test`.

const LETTERS = ['A', 'B', 'C', 'D', 'E']
const MAX_CUES = 40

/** "#ff8800" -> 0xff8800, invalid -> null */
function parseColor(hex) {
	if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
	return parseInt(hex.slice(1), 16)
}

/** Readable text colour (0xffffff or 0) on a background colour. */
function textColor(col) {
	const r = (col >> 16) & 255, g = (col >> 8) & 255, b = col & 255
	return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? 0x000000 : 0xffffff
}

/** Seconds -> "1:05" (or "" for null). Rounded up, so "0:00" means really finished. */
function formatTime(sec) {
	if (sec === null || sec === undefined || !Number.isFinite(sec)) return ''
	const s = Math.max(0, Math.ceil(sec - 0.05))
	const m = Math.floor(s / 60)
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Bank option -> letter. "current" uses the active bank from the last state. */
function resolveBank(option, state) {
	if (option === 'current') return LETTERS[state?.bank ?? 0] ?? 'A'
	return LETTERS.includes(option) ? option : 'A'
}

function bankIndex(letter) {
	return LETTERS.indexOf(letter)
}

/** Text command for CueMaster's WebSocket. */
function cueCommand(letter, cue, verb, number) {
	const n = Math.max(1, Math.min(MAX_CUES, Math.floor(Number(cue) || 1)))
	let cmd = `cue/${letter}/${n}`
	if (verb) cmd += `/${verb}`
	if (number !== undefined && number !== null && Number(number) > 0) cmd += ` ${Number(number)}`
	return cmd
}

function findCue(state, b, c) {
	return state?.cues?.find((x) => x.b === b && x.c === c) ?? null
}

/** Cue that is pre-listened on the PC in edit mode (PFL), separate from the show. CueMaster 1.1+. */
function findPfl(state, b, c) {
	return state?.pfl?.find((x) => x.b === b && x.c === c) ?? null
}

/** All variable values for the given labels and state. */
function variableValues(labels, state) {
	const v = {}
	const banks = labels?.banks ?? []
	const active = state?.bank ?? 0
	v.active_bank = LETTERS[active] ?? ''
	v.active_bank_name = banks[active]?.name || v.active_bank
	const f = state?.focus
	const fc = f ? findCue(state, f[0], f[1]) : null
	v.focus_name = f ? (banks[f[0]]?.cues?.[f[1]]?.name ?? '') : ''
	v.focus_cue = f ? `${LETTERS[f[0]]}${f[1] + 1}` : ''
	v.focus_remaining = fc ? formatTime(fc.rem) : ''
	v.focus_elapsed = fc ? formatTime(fc.pos) : ''
	LETTERS.forEach((l, bi) => {
		v[`bank_${l}_name`] = banks[bi]?.name || ''
	})
	// Show or edit mode on the PC, and what is pre-listened there (PFL). Older CueMaster versions send neither.
	v.mode = state?.mode === 'edit' ? 'EDIT' : state ? 'SHOW' : ''
	const pfl = (state?.pfl ?? []).find((x) => x.state !== 'stopping') ?? state?.pfl?.[0] ?? null
	v.pfl_name = pfl ? (banks[pfl.b]?.cues?.[pfl.c]?.name ?? '') : ''
	v.pfl_cue = pfl ? `${LETTERS[pfl.b]}${pfl.c + 1}` : ''
	v.pfl_remaining = pfl ? formatTime(pfl.rem) : ''
	v.playing_count = String((state?.cues ?? []).filter((x) => x.state === 'playing').length)
	banks.forEach((bank, bi) => {
		bank.cues.forEach((cue, ci) => {
			const id = `${LETTERS[bi]}_${ci + 1}`
			const run = findCue(state, bi, ci)
			v[`cue_${id}_name`] = cue.name
			v[`cue_${id}_state`] = run ? run.state : 'stopped'
			v[`cue_${id}_remaining`] = run ? formatTime(run.rem) : ''
		})
	})
	// Tiles of the active bank, so one Stream Deck page follows the bank switch.
	const cur = banks[active]
	for (let ci = 0; ci < MAX_CUES; ci++) {
		const cue = cur?.cues?.[ci]
		const run = cue ? findCue(state, active, ci) : null
		v[`current_${ci + 1}_name`] = cue ? cue.name : ''
		v[`current_${ci + 1}_state`] = run ? run.state : 'stopped'
		v[`current_${ci + 1}_remaining`] = run ? formatTime(run.rem) : ''
	}
	return v
}

/** Only the entries that differ from `prev`. */
function changed(prev, next) {
	const out = {}
	for (const [k, val] of Object.entries(next)) if (prev[k] !== val) out[k] = val
	return out
}

module.exports = { LETTERS, MAX_CUES, parseColor, textColor, formatTime, resolveBank, bankIndex, cueCommand, findCue, findPfl, variableValues, changed }
