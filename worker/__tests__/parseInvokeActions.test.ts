import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { looksLikeInvokeMarkup, parseInvokeActions } from '../do/parseInvokeActions'

const REPLY = `<invoke name="think"> <parameter name="text">Build boundaries, titles, ovals, actors compactly.</parameter> </invoke>
<invoke name="create"> <parameter name="intent">Mobile box</parameter> <parameter name="shape">{"_type":"rectangle","shapeId":"b_mob","x":-350,"y":3500,"w":300,"h":200,"color":"blue","fill":"tint","note":"Mobile Client"}</parameter> </invoke>
<invoke name="stack"> <parameter name="intent">Line up</parameter> <parameter name="direction">horizontal</parameter> <parameter name="gap">20</parameter> <parameter name="shapeIds">["b_mob","b_auth"]</parameter> </invoke>
<invoke name="message"> <parameter name="text">Building &quot;Stage 1&quot; now.</parameter> </invoke>`

describe('parseInvokeActions', () => {
	it('detects markup only when it comes before any JSON', () => {
		assert.ok(looksLikeInvokeMarkup(REPLY))
		assert.ok(looksLikeInvokeMarkup('<function_calls>\n<invoke name="think">'))
		assert.ok(!looksLikeInvokeMarkup('{"actions":[{"_type":"message","text":"<invoke name=\\"x\\">"}]}'))
		assert.ok(!looksLikeInvokeMarkup('plain prose'))
	})

	it('parses complete invokes into typed actions', () => {
		const actions = parseInvokeActions(REPLY)
		assert.deepEqual(
			actions.map((a) => a._type),
			['think', 'create', 'stack', 'message']
		)
		assert.equal(actions[0].text, 'Build boundaries, titles, ovals, actors compactly.')
		assert.deepEqual((actions[1].shape as { shapeId: string; x: number }).shapeId, 'b_mob')
		assert.equal((actions[1].shape as { x: number }).x, -350)
		assert.equal(actions[2].gap, 20)
		assert.deepEqual(actions[2].shapeIds, ['b_mob', 'b_auth'])
		assert.equal(actions[3].text, 'Building "Stage 1" now.')
	})

	it('keeps text params as strings even when numeric', () => {
		const [a] = parseInvokeActions('<invoke name="message"><parameter name="text">42</parameter></invoke>')
		assert.equal(a.text, '42')
	})

	it('handles a half-streamed last invoke', () => {
		const partial = REPLY.slice(0, REPLY.indexOf('"x":-350')) // mid-way through the create's shape JSON
		const actions = parseInvokeActions(partial)
		assert.equal(actions.length, 2)
		assert.equal(actions[1]._type, 'create')
		assert.equal(actions[1].intent, 'Mobile box')
		assert.equal(actions[1].shape, undefined, 'incomplete JSON is left out until it finishes')

		const streamingText = parseInvokeActions('<invoke name="message"><parameter name="text">Hello wor')
		assert.equal(streamingText[0].text, 'Hello wor')
	})
})
