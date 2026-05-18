/**
 * torProxy.js — Tor SOCKS5 proxy configuration for haveno-web
 *
 * Routes all gRPC-web traffic through Tor SOCKS5 proxy (127.0.0.1:9050).
 * Uses Envoy proxy to bridge gRPC-web (HTTP/1) to gRPC (HTTP/2) over Tor.
 *
 * Prerequisites:
 *   - Tor daemon running: `tor --SOCKSPort 9050`
 *   - Orbot on Android, Onion Browser on iOS
 *   - Envoy proxy with SOCKS5 upstream
 */

// ─── Tor proxy configuration ────────────────────────────────────────────
const TOR_PROXY = {
  host: '127.0.0.1',
  socksPort: 9050,
  controlPort: 9051,
  // Orbot uses different ports on Android
  android: {
    socksPort: 9050,
    controlPort: 9051,
    httpPort: 8118,
  },
}

// ─── Check if Tor is available ───────────────────────────────────────────
export async function isTorAvailable() {
  // Try connecting through Tor SOCKS5
  // We can't do a direct SOCKS5 connection from a browser,
  // but we can check if the Envoy proxy (which uses Tor) is accessible.
  try {
    const resp = await fetch('http://localhost:8080/health', { signal: AbortSignal.timeout(3000) })
    return true
  } catch (e) {
    console.log('[Tor] Envoy proxy not available on localhost:8080')
    return false
  }
}

/**
 * Check if we're running inside Tor Browser.
 * Tor Browser uses a specific user agent and navigator properties.
 */
export function isTorBrowser() {
  // Approximate detection — Tor Browser has specific screen dimensions and properties
  const suspiciouslyStandard = {}
  if (typeof screen !== 'undefined') {
    suspiciouslyStandard.width = screen.width
    suspiciouslyStandard.height = screen.height
    suspiciouslyStandard.availWidth = screen.availWidth
    suspiciouslyStandard.availHeight = screen.availHeight
  }
  // Tor Browser typically has standard 1000x900 inner dimensions
  const isStandardSize = suspiciouslyStandard.width && Math.abs(suspiciouslyStandard.width - 1000) < 100
  // Not definitive but gives a hint
  console.log('[Tor] Browser detection:', suspiciouslyStandard)
  return false // Returns false by default — user should configure
}

// ─── Envoy configuration generator ───────────────────────────────────────

/**
 * Generate an Envoy YAML configuration that proxies gRPC-web to gRPC
 * through the Tor SOCKS5 proxy.
 *
 * @param {object} opts
 * @param {string} opts.havenoDaemonHost - Haveno daemon gRPC endpoint (e.g., "someonion.onion:8079")
 * @param {number} opts.havenoDaemonPort - Haveno daemon gRPC port
 * @param {string} opts.moneroNodeHost - Remote Monero node (e.g., "node.someonion.onion:18081")
 * @param {boolean} opts.useTor - Whether to route through Tor SOCKS5
 */
export function generateEnvoyConfig(opts = {}) {
  const {
    havenoDaemonHost = 'localhost',
    havenoDaemonPort = 8079,
    moneroNodeHost = 'node.haveno.network',
    moneroNodePort = 17750,
    useTor = true,
  } = opts

  const torSocks5 = `${TOR_PROXY.host}:${TOR_PROXY.socksPort}`
  const havenoUpstream = useTor
    ? `addr:
      socket_address:
        address: ${torSocks5.split(':')[0]}
        port_value: ${parseInt(torSocks5.split(':')[1])}
        protocol: TCP
    transport_socket:
      name: envoy.transport_sockets.socks5
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.socks5.v3.Socks5Proxy
        address:
          socket_address:
            address: "${havenoDaemonHost}"
            port_value: ${havenoDaemonPort}`
    : `addr:
      socket_address:
        address: ${havenoDaemonHost}
        port_value: ${havenoDaemonPort}`

  return `
static_resources:
  listeners:
  - name: listener_http
    address:
      socket_address:
        address: 0.0.0.0
        port_value: 8080
    filter_chains:
    - filters:
      - name: envoy.filters.network.http_connection_manager
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          codec_type: AUTO
          stat_prefix: ingress_http
          route_config:
            name: local_route
            virtual_hosts:
            - name: haveno
              domains: ["*"]
              routes:
              - match:
                  prefix: "/"
                route:
                  cluster: haveno_grpc
                  timeout: 300s
              cors:
                allow_origin_string_match:
                - prefix: "*"
                allow_methods: GET, PUT, DELETE, POST, OPTIONS
                allow_headers: keep-alive,user-agent,cache-control,content-type,content-transfer-encoding,custom-header-1,x-accept-content-transfer-encoding,x-accept-response-streaming,x-user-agent,x-grpc-web,grpc-timeout,password,authorization
                expose_headers: custom-header-1,grpc-status,grpc-message,grpc-encoding,grpc-accept-encoding
                max_age: "1728000"
              access_control_request_headers: "*"
          http_filters:
          - name: envoy.filters.http.grpc_web
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.grpc_web.v3.GrpcWebFilter
          - name: envoy.filters.http.router
            typed_config:
              "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
  clusters:
  - name: haveno_grpc
    type: STRICT_DNS
    connect_timeout: 30s
    lb_policy: ROUND_ROBIN
    http2_protocol_options: {}
    load_assignment:
      cluster_name: haveno_grpc
      endpoints:
      - lb_endpoints:
        - endpoint:
            ${havenoUpstream}
`
}

// ─── Exports ─────────────────────────────────────────────────────────────
export { TOR_PROXY }
