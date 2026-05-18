/**
 * ledgerMonero.test.js — Unit tests for Ledger Monero WebUSB communication layer
 *
 * Tests APDU frame construction, command encoding, and response parsing
 * without requiring a physical Ledger device.
 */

import { describe, it, expect, vi } from 'vitest'
import { toHex, hexToBytes, INS, SW, encodeBip44ForLedger } from '../ledgerMonero.js'

describe('toHex', () => {
  it('converts Uint8Array to hex string', () => {
    const bytes = new Uint8Array([0x04, 0x20, 0x01, 0x00, 0x00])
    expect(toHex(bytes)).toBe('0420010000')
  })

  it('handles empty array', () => {
    expect(toHex(new Uint8Array([]))).toBe('')
  })

  it('pads single-digit hex values', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff])
    expect(toHex(bytes)).toBe('000fff')
  })

  it('handles null', () => {
    expect(toHex(null)).toBe('')
  })
})

describe('hexToBytes', () => {
  it('converts hex string to ArrayBuffer', () => {
    const buffer = hexToBytes('0420010000')
    const bytes = new Uint8Array(buffer)
    expect(bytes.length).toBe(5)
    expect(bytes[0]).toBe(0x04)
    expect(bytes[1]).toBe(0x20)
    expect(bytes[2]).toBe(0x01)
    expect(bytes[3]).toBe(0x00)
    expect(bytes[4]).toBe(0x00)
  })

  it('handles 0x prefix', () => {
    const buffer = hexToBytes('0x04')
    const bytes = new Uint8Array(buffer)
    expect(bytes[0]).toBe(0x04)
  })

  it('handles lowercase', () => {
    const buffer = hexToBytes('abcd')
    const bytes = new Uint8Array(buffer)
    expect(bytes[0]).toBe(0xab)
    expect(bytes[1]).toBe(0xcd)
  })
})

describe('APDU Constants', () => {
  it('INS_GET_KEY is 0x20', () => {
    expect(INS.GET_KEY).toBe(0x20)
  })

  it('INS_OPEN_TX is 0x70', () => {
    expect(INS.OPEN_TX).toBe(0x70)
  })

  it('INS_CLSAG is 0x7F', () => {
    expect(INS.CLSAG).toBe(0x7f)
  })

  it('INS_CLOSE_TX is 0x80', () => {
    expect(INS.CLOSE_TX).toBe(0x80)
  })

  it('SW_DENY is 0x6982', () => {
    expect(SW.DENY).toBe(0x6982)
  })

  it('SW_CLIENT_NOT_SUPPORTED is 0x6D01', () => {
    // This indicates the Ledger app version is too old
    expect(SW.CLIENT_NOT_SUPPORTED).toBe(0x6d01)
  })
})

describe('BIP44 encoding', () => {
  it('encodes Monero BIP44 path', () => {
    const { path } = encodeBip44ForLedger(0)
    // JS bitops produce signed 32-bit ints; use >>> 0 for unsigned comparison
    expect(path[0] >>> 0).toBe(0x8000002c) // 44'
    expect(path[1] >>> 0).toBe(0x80000080) // 128'
    expect(path[2] >>> 0).toBe(0x80000000) // 0'
  })
})
