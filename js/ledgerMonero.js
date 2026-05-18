/**
 * ledgerMonero.js — WebUSB APDU transport for Monero app on Ledger Nano X/S
 *
 * Protocol matches device_ledger.cpp from monero-project/monero:
 *   CLA = 0x04 (PROTOCOL_VERSION=4)
 *   SW_OK = 0x9000
 *
 * See: monero/src/device/device_ledger.cpp
 */

// ─── APDU constants (from device_ledger.cpp) ────────────────────────────
const CLA = 0x04

const INS = {
  NONE:                    0x00,
  RESET:                   0x02,
  GET_KEY:                 0x20,
  DISPLAY_ADDRESS:         0x21,
  PUT_KEY:                 0x22,
  GET_CHACHA8_PREKEY:      0x24,
  VERIFY_KEY:              0x26,
  MANAGE_SEEDWORDS:        0x28,
  SECRET_KEY_TO_PUBLIC_KEY:0x30,
  GEN_KEY_DERIVATION:      0x32,
  DERIVATION_TO_SCALAR:    0x34,
  DERIVE_PUBLIC_KEY:       0x36,
  DERIVE_SECRET_KEY:       0x38,
  GEN_KEY_IMAGE:           0x3A,
  DERIVE_VIEW_TAG:         0x3B,
  SECRET_KEY_ADD:          0x3C,
  SECRET_KEY_SUB:          0x3E,
  GENERATE_KEYPAIR:        0x40,
  SECRET_SCAL_MUL_KEY:     0x42,
  GET_SUBADDRESS:          0x44,
  GET_SUBADDRESS_SPEND_PUBLIC_KEY: 0x46,
  GET_SUBADDRESS_SECRET_KEY:0x4C,
  OPEN_TX:                 0x70,
  SET_SIGNATURE_MODE:      0x72,
  GET_ADDITIONAL_KEY:      0x74,
  STEALTH:                 0x76,
  GEN_COMMITMENT_MASK:     0x77,
  BLIND:                   0x78,
  UNBLIND:                 0x7A,
  GEN_TXOUT_KEYS:          0x7B,
  VALIDATE:                0x7C,
  PREFIX_HASH:             0x7D,
  MLSAG:                   0x7E,
  CLSAG:                   0x7F,
  CLOSE_TX:                0x80,
  GET_TX_PROOF:            0xA0,
  GET_RESPONSE:            0xC0,
}

// Status words — see device_ledger.cpp for complete list
const SW = {
  OK:                           0x9000,
  WRONG_LENGTH:                 0x6700,
  SECURITY_PIN_LOCKED:          0x6B00,
  SECURITY_LOAD_KEY:            null,
  SECURITY_COMMITMENT_CONTROL:  null,
  SECURITY_AMOUNT_CHAIN_CONTROL: null,
  SECURITY_COMMITMENT_CHAIN_CONTROL: null,
  SECURITY_OUTKEYS_CHAIN_CONTROL: null,
  SECURITY_HMAC:                null,
  SECURITY_RANGE_VALUE:         null,
  SECURITY_INTERNAL:            null,
  SECURITY_MAX_SIGNATURE_REACHED: null,
  SECURITY_PREFIX_HASH:         null,
  SECURITY_LOCKED:              null,
  COMMAND_NOT_ALLOWED:          null,
  SUBCOMMAND_NOT_ALLOWED:       null,
  DENY:                         0x6982,
  KEY_NOT_SET:                  null,
  WRONG_DATA:                   0x6A80,
  WRONG_DATA_RANGE:             0x6A81,
  IO_FULL:                      0x6A82,
  CLIENT_NOT_SUPPORTED:         0x6D01,
  WRONG_P1P2:                   0x6B00,
  INS_NOT_SUPPORTED:            0x6D00,
  PROTOCOL_NOT_SUPPORTED:       0x6F00,
  UNKNOWN:                      0x6F01,
}

const SW_MESSAGES = {
  0x6982: 'DENY — User rejected the operation on the device',
  0x6D01: 'CLIENT_NOT_SUPPORTED — Monero Ledger App version too old. Please update.',
  0x6F00: 'PROTOCOL_NOT_SUPPORTED — Make sure no other app is communicating with the Ledger.',
  0x6700: 'WRONG_LENGTH — Invalid APDU data length.',
  0x6B00: 'WRONG_P1P2 — Invalid P1/P2 parameters.',
  0x6D00: 'INS_NOT_SUPPORTED — Instruction not supported.',
  0x6A80: 'WRONG_DATA — Invalid data format.',
  0x6A81: 'WRONG_DATA_RANGE — Data out of valid range.',
}

// ─── Byte utilities ─────────────────────────────────────────────────────
function toHex(bytes) {
  if (bytes == null) return ''
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  return bytes.buffer
}

function concatUint8(...arrays) {
  const total = arrays.reduce((s, a) => s + (a?.length || 0), 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    if (arr) { result.set(arr, offset); offset += arr.length }
  }
  return result
}

function uint32Be(n) {
  const buf = new Uint8Array(4)
  buf[0] = (n >>> 24) & 0xff
  buf[1] = (n >>> 16) & 0xff
  buf[2] = (n >>> 8) & 0xff
  buf[3] = n & 0xff
  return buf
}

// ─── WebUSB transport ────────────────────────────────────────────────────
class LedgerMoneroTransport {
  constructor() {
    this.device = null
    this.channel = 0x0101
    this.packetSize = 64
  }

  /**
   * Request a Ledger device via browser WebUSB picker.
   * Filters by Ledger vendor ID 0x2C97.
   */
  async connect() {
    if (!('usb' in navigator)) {
      throw new Error('WebUSB not available. Use a Chromium-based browser (Chrome, Edge, Brave) or Tor Browser with WebUSB enabled.')
    }

    console.log('[LedgerMonero] Requesting WebUSB device...')
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: 0x2C97 }]
    })

    await device.open()
    if (device.configuration === null) {
      await device.selectConfiguration(1)
    }
    await device.claimInterface(0)
    this.device = device
    console.log('[LedgerMonero] Connected:', device.productName, device.serialNumber)
    return { productName: device.productName, serialNumber: device.serialNumber }
  }

  async disconnect() {
    if (this.device) {
      try { await this.device.close() } catch (e) { /* ignore */ }
      this.device = null
    }
  }

  isConnected() {
    return this.device !== null && this.device.opened
  }

  /**
   * Send an APDU command and receive the response.
   * Frame format: [channel(2) | tag(1) | sequence(2) | length(2) | data]
   */
  async exchange(apdu) {
    if (!this.device) throw new Error('Device not connected')

    const apduBytes = new Uint8Array(apdu)
    const frameSize = this.packetSize - 7 // channel(2)+tag(1)+seq(2)+len(2)

    // Send
    for (let i = 0; i < apduBytes.length; i += frameSize) {
      const chunk = apduBytes.slice(i, i + frameSize)
      const frame = new Uint8Array(7 + chunk.length)
      frame[0] = (this.channel >>> 8) & 0xff
      frame[1] = this.channel & 0xff
      frame[2] = 0x05 // TAG_APDU
      frame[3] = (i >>> 8) & 0xff
      frame[4] = i & 0xff
      frame[5] = (apduBytes.length >>> 8) & 0xff
      frame[6] = apduBytes.length & 0xff
      frame.set(chunk, 7)

      const result = await this.device.transferOut(2, frame) // endpoint 2 = OUT
      if (result.status !== 'ok') throw new Error(`USB transferOut failed: ${result.status}`)
    }

    // Receive
    const recvResult = await this.device.transferIn(1, this.packetSize) // endpoint 1 = IN
    if (recvResult.status !== 'ok') throw new Error(`USB transferIn failed: ${recvResult.status}`)
    const resp = new Uint8Array(recvResult.data.buffer)

    // Parse header
    const recvLength = (resp[5] << 8) | resp[6]
    let offset = 7
    let responseData = resp.slice(offset, offset + recvLength)
    offset += recvLength

    // Handle multi-packet responses if needed (simplified — single packet for MVP)
    while (offset + 7 <= resp.length) {
      const nextTag = resp[offset]
      const nextLen = (resp[offset + 5] << 8) | resp[offset + 6]
      offset += 7
      responseData = concatUint8(responseData, resp.slice(offset, offset + nextLen))
      offset += nextLen
    }

    // Last 2 bytes = SW
    const sw = (responseData[responseData.length - 2] << 8) | responseData[responseData.length - 1]
    const data = responseData.slice(0, responseData.length - 2)

    return { data, sw }
  }
}

// ─── Monero Ledger app ───────────────────────────────────────────────────
class LedgerMonero {
  constructor() {
    this.transport = new LedgerMoneroTransport()
  }

  // ── Connection ──────────────────────────────────────────────────────
  async connect() {
    return this.transport.connect()
  }

  async disconnect() {
    return this.transport.disconnect()
  }

  isConnected() {
    return this.transport.isConnected()
  }

  // ── Low-level APDU exchange ──────────────────────────────────────────
  async _exchange(ins, p1, p2, data) {
    const header = new Uint8Array(5)
    header[0] = CLA       // PROTOCOL_VERSION
    header[1] = ins
    header[2] = p1
    header[3] = p2
    header[4] = data ? data.length : 0x00

    const apdu = data ? concatUint8(header, new Uint8Array(data)) : header

    const response = await this.transport.exchange(apdu)

    if (response.sw === SW.DENY) {
      throw new Error(SW_MESSAGES[SW.DENY] || 'User denied')
    }
    if (response.sw === SW.CLIENT_NOT_SUPPORTED) {
      throw new Error(SW_MESSAGES[SW.CLIENT_NOT_SUPPORTED] || 'Ledger app version unsupported')
    }
    if (response.sw === SW.PROTOCOL_NOT_SUPPORTED) {
      throw new Error(SW_MESSAGES[SW.PROTOCOL_NOT_SUPPORTED] || 'Protocol not supported')
    }
    if (response.sw !== SW.OK) {
      const msg = SW_MESSAGES[response.sw] || `Unknown SW: 0x${response.sw.toString(16).padStart(4, '0')}`
      throw new Error(`Ledger error: ${msg}`)
    }

    return response.data
  }

  // ── Device control ───────────────────────────────────────────────────
  async reset() {
    const moneroVersion = await (async () => {
      try {
        const pkg = await (await fetch('/package.json').catch(() => null))
        if (pkg) {
          const p = await pkg.json()
          return p.version || '0.0.8'
        }
      } catch (_) {}
      return '0.0.8'
    })()

    const encoder = new TextEncoder()
    const verBytes = encoder.encode(moneroVersion)
    return this._exchange(INS.RESET, 0x00, 0x00, verBytes)
  }

  // ── Key retrieval ────────────────────────────────────────────────────

  /** Get public address (view + spend) — P1=0x01 */
  async getPublicAddress() {
    const data = await this._exchange(INS.GET_KEY, 0x01, 0x00)
    if (data.length < 64) throw new Error('Invalid public address response')
    return {
      viewPublicKey:  toHex(data.slice(0, 32)),
      spendPublicKey: toHex(data.slice(32, 64)),
    }
  }

  /** Get view private key (user must confirm on device) — P1=0x02 */
  async getViewPrivateKey() {
    try {
      const data = await this._exchange(INS.GET_KEY, 0x02, 0x00)
      if (data.length < 32) throw new Error('Invalid view key response')
      return toHex(data.slice(0, 32))
    } catch (err) {
      if (err.message?.includes('Denied') || err.message?.includes('deny')) {
        throw new Error('View key export rejected on device. You must approve on the Ledger.')
      }
      throw err
    }
  }

  // ── Display address on device ────────────────────────────────────────
  async displayAddress(accountIndex = 0, addressIndex = 0, paymentId = null) {
    const p1 = paymentId ? 0x01 : 0x00
    const index = new Uint8Array(8)
    index[0] = (accountIndex >>> 24) & 0xff
    index[1] = (accountIndex >>> 16) & 0xff
    index[2] = (accountIndex >>> 8) & 0xff
    index[3] = accountIndex & 0xff
    index[4] = (addressIndex >>> 24) & 0xff
    index[5] = (addressIndex >>> 16) & 0xff
    index[6] = (addressIndex >>> 8) & 0xff
    index[7] = addressIndex & 0xff

    let pid = new Uint8Array(8)
    if (paymentId) {
      const hex = paymentId.startsWith('0x') ? paymentId.slice(2) : paymentId
      for (let i = 0; i < 8 && i * 2 < hex.length; i++)
        pid[i] = parseInt(hex.substr(i * 2, 2), 16)
    }

    const cmd = concatUint8(index, pid)
    return this._exchange(INS.DISPLAY_ADDRESS, p1, 0x00, cmd)
  }

  // ── Key image generation ─────────────────────────────────────────────
  async generateKeyImage(derivation, outputIndex, pub) {
    const derivationBytes = new Uint8Array(typeof derivation === 'string' ? hexToBytes(derivation) : derivation)
    const outputIdxBytes = uint32Be(outputIndex)
    const pubBytes = new Uint8Array(typeof pub === 'string' ? hexToBytes(pub) : pub)
    const cmd = concatUint8(derivationBytes, outputIdxBytes, pubBytes)
    const data = await this._exchange(INS.GEN_KEY_IMAGE, 0x00, 0x00, cmd)
    return toHex(data.slice(0, 32))
  }

  // ── Signature mode ───────────────────────────────────────────────────
  async setSignatureMode(mode) {
    // mode: 0=TRANSACTION_CREATE_REAL, 1=TRANSACTION_CREATE_FAKE
    return this._exchange(INS.SET_SIGNATURE_MODE, 0x01, 0x00, new Uint8Array([mode & 0xff]))
  }

  // ── Transaction operations ────────────────────────────────────────────

  /**
   * Open a new transaction.
   * Returns { txKey, R, r } — txKey is the transaction private key
   */
  async openTx() {
    const data = await this._exchange(INS.OPEN_TX, 0x01, 0x00)
    return {
      R_raw: toHex(data.slice(0, 32)),
      r_raw: toHex(data.slice(32, 64)),
    }
  }

  /** Hash transaction prefix */
  async prefixHash(hashData, mode = 1, counter = 0) {
    const hashBytes = new Uint8Array(typeof hashData === 'string' ? hexToBytes(hashData) : hashData)
    if (mode === 1) {
      return this._exchange(INS.PREFIX_HASH, 0x01, 0x00, hashBytes)
    }
    return this._exchange(INS.PREFIX_HASH, 0x02, counter, hashBytes)
  }

  /** Blind an amount commitment */
  async blind(amountData) {
    const bytes = new Uint8Array(typeof amountData === 'string' ? hexToBytes(amountData) : amountData)
    return this._exchange(INS.BLIND, 0x00, 0x00, bytes)
  }

  /** Unblind an amount commitment */
  async unblind(amountData) {
    const bytes = new Uint8Array(typeof amountData === 'string' ? hexToBytes(amountData) : amountData)
    return this._exchange(INS.UNBLIND, 0x00, 0x00, bytes)
  }

  /** Generate transaction output keys */
  async genTxOutKeys(outKeysData) {
    const bytes = new Uint8Array(typeof outKeysData === 'string' ? hexToBytes(outKeysData) : outKeysData)
    return this._exchange(INS.GEN_TXOUT_KEYS, 0x00, 0x00, bytes)
  }

  /** Generate stealth address for outputs */
  async stealth(stealthData) {
    const bytes = new Uint8Array(typeof stealthData === 'string' ? hexToBytes(stealthData) : stealthData)
    return this._exchange(INS.STEALTH, 0x00, 0x00, bytes)
  }

  /** CLSAG signing */
  async clsag(signData) {
    const bytes = new Uint8Array(typeof signData === 'string' ? hexToBytes(signData) : signData)
    return this._exchange(INS.CLSAG, 0x00, 0x00, bytes)
  }

  /** Close the current transaction — returns the final transaction key */
  async closeTx() {
    const data = await this._exchange(INS.CLOSE_TX, 0x00, 0x00)
    return { txOutputData: toHex(data) }
  }

  /** Get transaction proof */
  async getTxProof(txHash) {
    const hashBytes = new Uint8Array(typeof txHash === 'string' ? hexToBytes(txHash) : txHash)
    return this._exchange(INS.GET_TX_PROOF, 0x00, 0x00, hashBytes)
  }
}

// ─── HD derivation helpers (used by higher-level wallet code) ─────────────
const MONERO_BIP44_PATH = "m/44'/128'/0'"

function encodeBip44ForLedger(account = 0) {
  // 44' = 0x8000002C, 128' = 0x80000080, 0' = 0x80000000
  const path = new Uint8Array(5) // 3 hardened levels + account
  return {
    path: [0x80000000 | 44, 0x80000000 | 128, 0x80000000 | account],
    pathBytes: new Uint8Array([3, 0x8000002c, 0x80000080, 0x80000000, account & 0xff]),
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────
export {
  LedgerMonero,
  LedgerMoneroTransport,
  CLA,
  INS,
  SW,
  SW_MESSAGES,
  MONERO_BIP44_PATH,
  encodeBip44ForLedger,
  toHex,
  hexToBytes,
}
