#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES_DIR="${ROOT_DIR}/services"

usage() {
  echo "Usage:"
  echo "  $0 <service-name>"
  echo "  $0 --all"
}

setup_one() {
  local service_name="$1"
  local service_path="${SERVICES_DIR}/${service_name}"
  local requirements="${service_path}/requirements.txt"
  local venv_path="${service_path}/.venv"

  if [[ ! -d "${service_path}" ]]; then
    echo "Error: service not found: ${service_name}"
    exit 1
  fi

  if [[ ! -f "${requirements}" ]]; then
    echo "Error: requirements.txt not found for ${service_name}"
    exit 1
  fi

  echo "Setting up venv for ${service_name}..."
  python3 -m venv "${venv_path}"
  # shellcheck disable=SC1090
  source "${venv_path}/bin/activate"
  python -m pip install --upgrade pip
  pip install -r "${requirements}"
  deactivate

  echo "Done: ${service_name}"
  echo "Activate with: source services/${service_name}/.venv/bin/activate"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

if [[ "$1" == "--all" ]]; then
  for req in "${SERVICES_DIR}"/*/requirements.txt; do
    service="$(basename "$(dirname "${req}")")"
    setup_one "${service}"
  done
  exit 0
fi

setup_one "$1"
