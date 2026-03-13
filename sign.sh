#!/usr/bin/env bash
set -euo pipefail

# Load credentials from .env
if [[ ! -f .env ]]; then
  echo "Error: .env file not found. Copy .env.example to .env and fill in your credentials."
  exit 1
fi

source .env

if [[ "${WEB_EXT_API_KEY:-}" == "your_api_key_here" || -z "${WEB_EXT_API_KEY:-}" ]]; then
  echo "Error: WEB_EXT_API_KEY is not set in .env"
  exit 1
fi

if [[ "${WEB_EXT_API_SECRET:-}" == "your_api_secret_here" || -z "${WEB_EXT_API_SECRET:-}" ]]; then
  echo "Error: WEB_EXT_API_SECRET is not set in .env"
  exit 1
fi

# Read current version from manifest.json
current_version=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
echo "Current version: $current_version"

IFS='.' read -r major minor patch <<< "$current_version"

echo ""
echo "How would you like to bump the version?"
echo "  1) patch ($major.$minor.$((patch + 1)))"
echo "  2) minor ($major.$((minor + 1)).0)"
echo "  3) major ($((major + 1)).0.0)"
echo ""
read -rp "Choose [1/2/3]: " bump_choice

case "$bump_choice" in
  1) new_version="$major.$minor.$((patch + 1))" ;;
  2) new_version="$major.$((minor + 1)).0" ;;
  3) new_version="$((major + 1)).0.0" ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

echo "New version: $new_version"

# Update version in manifest.json
python3 -c "
import json
with open('manifest.json', 'r') as f:
    manifest = json.load(f)
manifest['version'] = '$new_version'
with open('manifest.json', 'w') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')
"

echo "Updated manifest.json to version $new_version"

# Choose channel
echo ""
echo "Which channel?"
echo "  1) unlisted"
echo "  2) listed"
echo ""
read -rp "Choose [1/2]: " channel_choice

case "$channel_choice" in
  1) channel="unlisted" ;;
  2) channel="listed" ;;
  *)
    echo "Invalid choice."
    exit 1
    ;;
esac

echo ""
echo "Signing version $new_version on the $channel channel..."
echo ""

web-ext sign --channel="$channel" --api-key="$WEB_EXT_API_KEY" --api-secret="$WEB_EXT_API_SECRET"
