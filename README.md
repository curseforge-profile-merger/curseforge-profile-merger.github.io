# CurseForge Profile Merger

Статический веб-сервис для объединения двух Minecraft-профилей CurseForge.

Сайт: https://curseforge-profile-merger.github.io/

## Что делает

- принимает для каждого профиля либо CurseForge share-ссылку/код, либо экспортированный `.zip`;
- для share-кода обращается к `https://api.curseforge.com/v1/shared-profile/<code>` и загружает ZIP в браузер;
- читает `manifest.json` прямо в браузере;
- объединяет `manifest.files` по `projectID`;
- при одинаковом `projectID`, но разных `fileID`, оставляет версию базового профиля;
- проверяет версию Minecraft и семейство modloader (NeoForge/Forge/Fabric/Quilt);
- по умолчанию сохраняет только `overrides` базового профиля;
- опционально добавляет из второго профиля только отсутствующие файлы `overrides`, ничего не перезаписывая;
- генерирует новый ZIP с `manifest.json` и `overrides/` в корне;
- позволяет отдельно скачать `merge-report.json`.

Локально выбранные ZIP никуда не загружаются. При использовании share-ссылки браузер скачивает соответствующий профиль с CurseForge. Share-коды CurseForge действуют 7 дней.

## Запуск

Можно просто открыть `index.html`. Для браузеров, которые ограничивают локальные CDN-скрипты, удобнее запустить простой HTTP-сервер:

```bash
python3 -m http.server 8080
```

и открыть `http://localhost:8080`.

## GitHub Pages

В репозитории есть `.github/workflows/pages.yml`. После push в `main` workflow публикует статический сайт через GitHub Pages.

## Алгоритм конфликтов

Если один и тот же `projectID` присутствует в обоих manifest:

- одинаковый `fileID` → одна запись;
- разные `fileID` → остаётся версия выбранного базового профиля.

CurseForge не принимает manifest, где один `projectID` встречается несколько раз.

## Ограничения

Сервис не проверяет через CurseForge API совместимость каждого конкретного `fileID` с Minecraft/modloader. Он сравнивает метаданные двух профилей. Если версии Minecraft или семейства modloader отличаются, merge по умолчанию блокируется.

Если CurseForge изменит политику CORS для `shared-profile`, браузерный импорт по ссылке может перестать работать; обычный ZIP-импорт при этом останется доступен.

`overrides/mods/*.jar` могут содержать сторонние моды. Не импортируйте ZIP из недоверенного источника.
