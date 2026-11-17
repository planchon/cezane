#!/bin/bash
# Installe ou met à jour Cezane (Mac Apple Silicon) :
#   curl -fsSL https://raw.githubusercontent.com/planchon/cezane/main/install.sh | bash
# Télécharge la dernière release dans /Applications, puis installe ffmpeg et whisper-cpp avec
# Homebrew s'ils manquent. Variables : CEZANE_INSTALL_DIR (défaut /Applications), CEZANE_VERSION
# (ex. v0.1.0, défaut la dernière), CEZANE_NO_DEPS=1 pour ne rien installer avec Homebrew.
set -euo pipefail

REPO="planchon/cezane"
DEST="${CEZANE_INSTALL_DIR:-/Applications}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

main() {
  [ "$(uname -s)" = "Darwin" ] || fail "Cezane ne fonctionne que sur macOS."
  [ "$(uname -m)" = "arm64" ] || fail "Cezane demande un Mac Apple Silicon (M1 ou plus récent)."

  if [ -n "${CEZANE_VERSION:-}" ]; then
    api="https://api.github.com/repos/$REPO/releases/tags/$CEZANE_VERSION"
  else
    api="https://api.github.com/repos/$REPO/releases/latest"
  fi
  url="$(curl -fsSL "$api" | grep -o '"browser_download_url": *"[^"]*-arm64\.zip"' | head -1 | sed -E 's/.*"(https[^"]+)"/\1/')"
  [ -n "$url" ] || fail "Aucune release trouvée sur https://github.com/$REPO/releases."

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  say "Téléchargement de ${url##*/}"
  curl -fL --progress-bar "$url" -o "$tmp/Cezane.zip"
  ditto -x -k "$tmp/Cezane.zip" "$tmp/app"
  [ -d "$tmp/app/Cezane.app" ] || fail "L'archive ne contient pas Cezane.app."

  # Ferme Cezane s'il tourne, pour remplacer l'app.
  osascript -e 'tell application id "app.cezane.desktop" to quit' >/dev/null 2>&1 || true

  sudo_if_needed=""
  [ -w "$DEST" ] || sudo_if_needed="sudo"
  say "Installation dans $DEST/Cezane.app"
  $sudo_if_needed rm -rf "$DEST/Cezane.app"
  $sudo_if_needed ditto "$tmp/app/Cezane.app" "$DEST/Cezane.app"
  # L'app n'est pas notarisée : sans attribut de quarantaine, macOS l'ouvre sans la bloquer.
  $sudo_if_needed xattr -dr com.apple.quarantine "$DEST/Cezane.app" 2>/dev/null || true

  if [ "${CEZANE_NO_DEPS:-}" != "1" ]; then
    brew_bin="$(command -v brew || true)"
    [ -n "$brew_bin" ] || { [ -x /opt/homebrew/bin/brew ] && brew_bin=/opt/homebrew/bin/brew; } || true
    if [ -n "$brew_bin" ]; then
      missing=()
      "$brew_bin" list --formula ffmpeg >/dev/null 2>&1 || missing+=(ffmpeg)
      "$brew_bin" list --formula whisper-cpp >/dev/null 2>&1 || missing+=(whisper-cpp)
      if [ ${#missing[@]} -gt 0 ]; then
        say "Installation avec Homebrew : ${missing[*]}"
        "$brew_bin" install "${missing[@]}" </dev/null
      fi
    else
      say "Homebrew est absent. Installe-le (https://brew.sh), puis : brew install ffmpeg whisper-cpp"
    fi
  fi

  if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
    say "Claude Code est absent. Installe-le, puis lance « claude » une fois pour te connecter :"
    echo "  curl -fsSL https://claude.ai/install.sh | bash"
  fi

  say "Cezane est installé. Ouvre-le depuis Applications."
  echo "Au premier lancement, l'app vérifie ce qui manque et télécharge le modèle de transcription (574 Mo)."
}

main "$@"
