# CurseForge Profile Merger

Статический веб-сервис для объединения двух Minecraft-профилей CurseForge.

Сайт: https://curseforge-profile-merger.github.io/

## Что делает

- принимает для каждого профиля либо CurseForge share-ссылку/код, либо экспортированный `.zip`;
- читает `manifest.json` прямо в браузере;
- объединяет `manifest.files` по `projectID`;
- при одинаковом `projectID`, но разных `fileID`, оставляет версию базового профиля;
- проверяет версию Minecraft и семейство modloader (NeoForge/Forge/Fabric/Quilt);
- по умолчанию сохраняет только `overrides` базового профиля;
- опционально добавляет из второго профиля только отсутствующие файлы `overrides`, ничего не перезаписывая;
- генерирует новый ZIP с `manifest.json` и `overrides/` в корне;
- позволяет отдельно скачать `merge-report.json`.

Локально выбранные ZIP никуда не загружаются.

## Как работает импорт по share-ссылке

CurseForge endpoint `https://api.curseforge.com/v1/shared-profile/<code>` отвечает редиректом на ZIP в `shared-profile-media.forgecdn.net`. Первый редирект не разрешает browser CORS, хотя сам Forge CDN разрешает загрузку из браузера.

Поэтому используется маленький serverless resolver `api/share.js`:

1. браузер отправляет resolver только share-код;
2. resolver получает у CurseForge HTTP redirect и возвращает JSON с прямым Forge CDN URL;
3. браузер скачивает ZIP напрямую с Forge CDN;
4. ZIP разбирается и объединяется локально.

Сам ZIP **не проходит через resolver**.

Share-коды CurseForge действуют ограниченное время (сейчас 7 дней).

### Настройка resolver

`api/share.js` совместим с Vercel Functions. После деплоя укажите его публичный URL в `config.js`:

```js
window.CFPM_SHARE_RESOLVER = "https://YOUR-PROJECT.vercel.app/api/share";
```

Resolver принимает только `GET ?code=<shareCode>`, валидирует код, разрешает только CurseForge/ForgeCDN redirect и разрешает CORS только для `https://curseforge-profile-merger.github.io` и локальной разработки.

## Локальный запуск

```bash
python3 -m http.server 8080
```

и открыть `http://localhost:8080`.

Для локального импорта share-ссылок нужен доступный resolver и его адрес в `config.js`.

## GitHub Pages

`.github/workflows/pages.yml` публикует статический сайт после push в `main`.

## Алгоритм конфликтов

Если один и тот же `projectID` присутствует в обоих manifest:

- одинаковый `fileID` → одна запись;
- разные `fileID` → остаётся версия выбранного базового профиля.

CurseForge не принимает manifest, где один `projectID` встречается несколько раз.

## Ограничения

Сервис не проверяет через CurseForge API совместимость каждого конкретного `fileID` с Minecraft/modloader. Он сравнивает метаданные двух профилей. Если версии Minecraft или семейства modloader отличаются, merge по умолчанию блокируется.

`overrides/mods/*.jar` могут содержать сторонние моды. Не импортируйте ZIP из недоверенного источника.
