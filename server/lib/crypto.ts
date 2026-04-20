import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
	const secret = process.env.KEY_ENCRYPTION_SECRET ?? 'dev-encryption-key-change-in-prod!!'
	return createHash('sha256').update(secret).digest()
}

export function encrypt(plaintext: string): string {
	const iv = randomBytes(12)
	const cipher = createCipheriv(ALGORITHM, getKey(), iv)
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
	const tag = cipher.getAuthTag()
	return `${iv.toString('hex')}.${tag.toString('hex')}.${encrypted.toString('hex')}`
}

export function decrypt(data: string): string {
	const parts = data.split('.')
	if (parts.length !== 3) throw new Error('Invalid encrypted data format')
	const [ivHex, tagHex, encHex] = parts
	const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'))
	decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
	return (
		decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') +
		decipher.final('utf8')
	)
}

/** Returns '••••••••<last4>' or empty string for null/undefined/unset keys */
export function maskKey(key: string | null | undefined): string {
	if (!key) return ''
	try {
		const decrypted = decrypt(key)
		return '••••••••' + decrypted.slice(-4)
	} catch {
		return ''
	}
}
