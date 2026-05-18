/**
 * ledgerElmBridge.js — Bridge between Elm ports and LedgerMonero JS library
 *
 * Handles Elm port messages to interface with Ledger Nano X via WebUSB.
 * Routes messages between elmInterop and the LedgerMonero class.
 */

import { LedgerMonero } from './ledgerMonero.js'

const ledger = new LedgerMonero()

/**
 * Initialize Elm port listeners.
 * Called from setupElm.mjs after Elm app mounts.
 *
 * @param {object} app - Elm application instance (exposes app.ports)
 */
export function initLedgerBridge(app) {
  if (!app || !app.ports) {
    console.warn('[LedgerBridge] No Elm ports available. Retrying in 1s...')
    setTimeout(() => {
      if (window.Elm && window.Elm.ports) initLedgerBridge(window.Elm)
    }, 1000)
    return
  }

  // ── Elm → JS: Request Ledger connection ──────────────────────────────
  if (app.ports.requestLedgerConnect) {
    app.ports.requestLedgerConnect.subscribe(async () => {
      try {
        console.log('[LedgerBridge] Elm requested Ledger connection')
        const deviceInfo = await ledger.connect()
        await ledger.reset()

        if (app.ports.receiveLedgerStatus) {
          app.ports.receiveLedgerStatus.send({
            typeOfMsg: 'ledgerConnected',
            status: 'connected',
            device: deviceInfo,
          })
        }
      } catch (err) {
        console.error('[LedgerBridge] Connection error:', err)
        if (app.ports.receiveLedgerStatus) {
          app.ports.receiveLedgerStatus.send({
            typeOfMsg: 'ledgerError',
            status: 'error',
            error: err.message || String(err),
          })
        }
      }
    })
  }

  // ── Elm → JS: Request public address from Ledger ─────────────────────
  if (app.ports.requestLedgerGetAddress) {
    app.ports.requestLedgerGetAddress.subscribe(async (params) => {
      try {
        console.log('[LedgerBridge] Elm requested public address')
        const { viewPublicKey, spendPublicKey } = await ledger.getPublicAddress()

        if (app.ports.receiveLedgerAddress) {
          app.ports.receiveLedgerAddress.send({
            typeOfMsg: 'ledgerAddress',
            status: 'ok',
            viewPublicKey,
            spendPublicKey,
            primaryAddress: `${viewPublicKey}${spendPublicKey}`,
          })
        }
      } catch (err) {
        console.error('[LedgerBridge] GetAddress error:', err)
        if (app.ports.receiveLedgerAddress) {
          app.ports.receiveLedgerAddress.send({
            typeOfMsg: 'ledgerAddress',
            status: 'error',
            error: err.message || String(err),
          })
        }
      }
    })
  }

  // ── Elm → JS: Request transaction signing via Ledger ─────────────────
  if (app.ports.requestLedgerSignTx) {
    app.ports.requestLedgerSignTx.subscribe(async (txData) => {
      try {
        console.log('[LedgerBridge] Elm requested transaction signing')

        // 1. Open transaction
        const opened = await ledger.openTx()

        // 2. Set signature mode (0 = real)
        await ledger.setSignatureMode(0)

        // 3. Hash prefix if provided
        if (txData.prefixHash) {
          await ledger.prefixHash(txData.prefixHash, 1)
        }

        // 4. Process stealth/out-keys if provided
        if (txData.stealth) {
          await ledger.stealth(txData.stealth)
        }
        if (txData.txOutKeys) {
          await ledger.genTxOutKeys(txData.txOutKeys)
        }
        if (txData.blind) {
          await ledger.blind(txData.blind)
        }
        if (txData.unblind) {
          await ledger.unblind(txData.unblind)
        }

        // 5. CLSAG signing if signing data provided
        if (txData.clsagData) {
          await ledger.clsag(txData.clsagData)
        }

        // 6. Close transaction
        const result = await ledger.closeTx()

        if (app.ports.receiveLedgerSignResult) {
          app.ports.receiveLedgerSignResult.send({
            typeOfMsg: 'ledgerSignResult',
            status: 'ok',
            txOutput: result.txOutputData,
            R: opened.R_raw,
            r: opened.r_raw,
          })
        }
      } catch (err) {
        console.error('[LedgerBridge] SignTx error:', err)
        if (app.ports.receiveLedgerSignResult) {
          app.ports.receiveLedgerSignResult.send({
            typeOfMsg: 'ledgerSignResult',
            status: 'error',
            error: err.message || String(err),
          })
        }
      }
    })
  }

  // ── Elm → JS: Display address on Ledger screen ───────────────────────
  if (app.ports.requestLedgerDisplayAddress) {
    app.ports.requestLedgerDisplayAddress.subscribe(async (params) => {
      try {
        console.log('[LedgerBridge] Elm requested display address')
        const { accountIndex = 0, addressIndex = 0, paymentId = null } = params || {}
        await ledger.displayAddress(accountIndex, addressIndex, paymentId)

        if (app.ports.receiveLedgerDisplayResult) {
          app.ports.receiveLedgerDisplayResult.send({
            typeOfMsg: 'ledgerDisplayResult',
            status: 'ok',
          })
        }
      } catch (err) {
        console.error('[LedgerBridge] DisplayAddress error:', err)
        if (app.ports.receiveLedgerDisplayResult) {
          app.ports.receiveLedgerDisplayResult.send({
            typeOfMsg: 'ledgerDisplayResult',
            status: 'error',
            error: err.message || String(err),
          })
        }
      }
    })
  }

  // ── Elm → JS: Request key image for an output ────────────────────────
  if (app.ports.requestLedgerKeyImage) {
    app.ports.requestLedgerKeyImage.subscribe(async (params) => {
      try {
        console.log('[LedgerBridge] Elm requested key image')
        const { derivation, outputIndex, pub } = params
        const keyImage = await ledger.generateKeyImage(derivation, outputIndex, pub)

        if (app.ports.receiveLedgerKeyImage) {
          app.ports.receiveLedgerKeyImage.send({
            typeOfMsg: 'ledgerKeyImage',
            status: 'ok',
            keyImage,
          })
        }
      } catch (err) {
        console.error('[LedgerBridge] KeyImage error:', err)
        if (app.ports.receiveLedgerKeyImage) {
          app.ports.receiveLedgerKeyImage.send({
            typeOfMsg: 'ledgerKeyImage',
            status: 'error',
            error: err.message || String(err),
          })
        }
      }
    })
  }

  // ── Elm → JS: Disconnect Ledger ──────────────────────────────────────
  if (app.ports.requestLedgerDisconnect) {
    app.ports.requestLedgerDisconnect.subscribe(async () => {
      await ledger.disconnect()
      console.log('[LedgerBridge] Ledger disconnected')
      if (app.ports.receiveLedgerStatus) {
        app.ports.receiveLedgerStatus.send({
          typeOfMsg: 'ledgerDisconnected',
          status: 'disconnected',
        })
      }
    })
  }

  console.log('[LedgerBridge] All Elm port listeners initialized')
}
