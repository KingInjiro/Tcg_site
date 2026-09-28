#!/bin/sh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
    printf '%s\n' 'Потрібен Node.js 24 LTS: https://nodejs.org/en/download' 'Після встановлення запустіть цей файл ще раз. Натисніть Enter, щоб закрити.'
    read -r tcg_reply
    exit 1
fi
node scripts/start-editor.js
tcg_status=$?
if [ "$tcg_status" -ne 0 ]; then
    printf '%s\n' 'Не вдалося запустити редактор. Прочитайте помилку вище. Натисніть Enter, щоб закрити.'
    read -r tcg_reply
fi
exit "$tcg_status"
