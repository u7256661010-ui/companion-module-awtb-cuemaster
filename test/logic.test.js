const test = require('node:test')
const assert = require('node:assert')
const L = require('../src/logic.js')

const labels = {
	gen: 1,
	banks: [
		{ letter: 'A', name: 'Intro', color: '#112233', cues: [{ name: 'Fanfare', color: '#ff0000', file: true }, { name: 'Tusch', color: null, file: true }] },
		{ letter: 'B', name: '', color: null, cues: [{ name: 'Applaus', color: null, file: true }] },
	],
}
const state = { type: 'state', bank: 1, labels: 1, focus: [0, 1], armed: null, cues: [{ b: 0, c: 1, state: 'playing', pos: 3.2, rem: 64.9, dur: 68.1 }] }

test('time format', () => {
	assert.strictEqual(L.formatTime(64.9), '1:05')
	assert.strictEqual(L.formatTime(0.02), '0:00')
	assert.strictEqual(L.formatTime(null), '')
})

test('colors and commands', () => {
	assert.strictEqual(L.parseColor('#ff8800'), 0xff8800)
	assert.strictEqual(L.parseColor(null), null)
	assert.strictEqual(L.resolveBank('current', state), 'B')
	assert.strictEqual(L.resolveBank('C', state), 'C')
	assert.strictEqual(L.cueCommand('A', 3), 'cue/A/3')
	assert.strictEqual(L.cueCommand('A', 3, 'fade', 1500), 'cue/A/3/fade 1500')
	assert.strictEqual(L.cueCommand('A', 3, 'fade', 0), 'cue/A/3/fade')
	assert.strictEqual(L.cueCommand('E', 99, 'stop'), 'cue/E/40/stop')
})

test('variables', () => {
	const v = L.variableValues(labels, state)
	assert.strictEqual(v.active_bank, 'B')
	assert.strictEqual(v.active_bank_name, 'B')
	assert.strictEqual(v.focus_name, 'Tusch')
	assert.strictEqual(v.focus_cue, 'A2')
	assert.strictEqual(v.focus_remaining, '1:05')
	assert.strictEqual(v.cue_A_2_state, 'playing')
	assert.strictEqual(v.cue_A_1_remaining, '')
	assert.strictEqual(v.current_1_name, 'Applaus')
	assert.strictEqual(v.current_2_name, '')
	assert.strictEqual(v.bank_A_name, 'Intro')
	assert.strictEqual(v.bank_C_name, '')
	assert.strictEqual(L.textColor(0xffffff), 0)
	assert.strictEqual(L.textColor(0x101010), 0xffffff)
	const d = L.changed(v, L.variableValues(labels, { ...state, cues: [] }))
	assert.deepStrictEqual(Object.keys(d).sort(), ['cue_A_2_remaining', 'cue_A_2_state', 'focus_elapsed', 'focus_remaining', 'playing_count'])
})

test('show and PFL are separate', () => {
	const st = { ...state, mode: 'edit', pfl: [{ b: 0, c: 0, state: 'playing', pos: 1, rem: 9.9, dur: 10.9 }] }
	const v = L.variableValues(labels, st)
	assert.strictEqual(v.mode, 'EDIT')
	assert.strictEqual(v.pfl_name, 'Fanfare')
	assert.strictEqual(v.pfl_cue, 'A1')
	assert.strictEqual(v.pfl_remaining, '0:10')
	assert.strictEqual(v.cue_A_1_state, 'stopped')
	assert.strictEqual(v.playing_count, '1')
	assert.ok(L.findPfl(st, 0, 0))
	assert.strictEqual(L.findPfl(st, 0, 1), null)
	// CueMaster 1.0 sends neither field.
	const old = L.variableValues(labels, state)
	assert.strictEqual(old.mode, 'SHOW')
	assert.strictEqual(old.pfl_name, '')
})
