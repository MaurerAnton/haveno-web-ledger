#!/bin/bash
# startEnvoy.sh — Start Envoy proxy (gRPC-web → gRPC) with optional Tor SOCKS5
#
# Usage:
#   ./terminals/startEnvoy.sh              # Default: localhost haveno daemon
#   ./terminals/startEnvoy.sh --tor         # Route through Tor SOCKS5
#   HAVENO_HOST=haveno.example.com HAVENO_PORT=8079 ./terminals/startEnvoy.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVOY_CONFIG="${DIR}/envoy.yaml"
HAVENO_HOST="${HAVENO_HOST:-localhost}"
HAVENO_PORT="${HAVENO_PORT:-8079}"
USE_TOR="${USE_TOR:-false}"
TOR_SOCKS="${TOR_SOCKS:-127.0.0.1:9050}"

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --tor) USE_TOR=true ;;
  esac
done

echo "=== Haveno-Web Envoy Proxy ==="
echo "  Haveno Daemon: ${HAVENO_HOST}:${HAVENO_PORT}"
echo "  Envoy HTTP:    0.0.0.0:8080"
echo "  Tor SOCKS5:    ${USE_TOR}"
echo ""

# Generate envoy config from template
if [ "$USE_TOR" = true ]; then
  echo "[INFO] Generating Tor SOCKS5 Envoy config..."
  # Create temp env with Tor upstream
  cat > /tmp/envoy-haveno-web.yaml << 'ENVOYEOF'
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
    connect_timeout: 60s
    lb_policy: ROUND_ROBIN
    http2_protocol_options: {}
    transport_socket:
      name: envoy.transport_sockets.socks5
      typed_config:
        "@type": type.googleapis.com/envoy.extensions.transport_sockets.socks5.v3.Socks5Proxy
        address:
          socket_address:
            address: 127.0.0.1
            port_value: 9050
    load_assignment:
      cluster_name: haveno_grpc
      endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: HAVENO_HOST_PLACEHOLDER
                port_value: HAVENO_PORT_PLACEHOLDER
ENVOYEOF
  sed -i "s/HAVENO_HOST_PLACEHOLDER/${HAVENO_HOST}/" /tmp/envoy-haveno-web.yaml
  sed -i "s/HAVENO_PORT_PLACEHOLDER/${HAVENO_PORT}/" /tmp/envoy-haveno-web.yaml
  CONFIG_FILE=/tmp/envoy-haveno-web.yaml
else
  # Generate local-only config
  cat > /tmp/envoy-haveno-web.yaml << ENVOYEOF
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
            address:
              socket_address:
                address: ${HAVENO_HOST}
                port_value: ${HAVENO_PORT}
ENVOYEOF
  CONFIG_FILE=/tmp/envoy-haveno-web.yaml
fi

# Check if Docker is available
if command -v docker &> /dev/null; then
  echo "[INFO] Starting Envoy via Docker..."
  docker run --rm \
    --add-host host.docker.internal:host-gateway \
    -v "${CONFIG_FILE}:/envoy.yaml" \
    -p 8080:8080 \
    envoyproxy/envoy-dev:latest \
    -c /envoy.yaml
else
  echo "[INFO] Docker not found, attempting native Envoy..."
  if command -v envoy &> /dev/null; then
    envoy -c "${CONFIG_FILE}"
  else
    echo "[ERROR] Neither Docker nor native envoy found."
    echo "  Install: https://www.envoyproxy.io/docs/envoy/latest/start/install"
    exit 1
  fi
fi
