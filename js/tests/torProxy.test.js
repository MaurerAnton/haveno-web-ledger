/**
 * torProxy.test.js — Unit tests for Tor proxy configuration
 */

import { describe, it, expect } from 'vitest'
import { isTorBrowser, generateEnvoyConfig } from '../torProxy.js'

describe('isTorBrowser', () => {
  it('returns false by default', () => {
    // In test environment (node), this should be false
    expect(isTorBrowser()).toBe(false)
  })
})

describe('generateEnvoyConfig', () => {
  it('generates local config without Tor', () => {
    const config = generateEnvoyConfig({
      havenoDaemonHost: 'localhost',
      havenoDaemonPort: 8079,
      useTor: false,
    })
    expect(config).toContain('port_value: 8080')
    expect(config).toContain('haveno_grpc')
    expect(config).toContain('localhost')
    expect(config).toContain('port_value: 8079')
  })

  it('generates config with Tor SOCKS5', () => {
    const config = generateEnvoyConfig({
      havenoDaemonHost: 'haveno.onion',
      havenoDaemonPort: 8079,
      useTor: true,
    })
    expect(config).toContain('Socks5Proxy')
    expect(config).toContain('haveno.onion')
  })

  it('defaults to localhost with Tor', () => {
    const config = generateEnvoyConfig()
    expect(config).toContain('haveno_grpc')
    expect(config).toContain('port_value: 8080')
  })
})
