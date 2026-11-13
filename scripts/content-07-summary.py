"""Summarize the pinned bulk bundle; never creates approvals or executable selections."""
import collections
import json
from pathlib import Path

base = Path(__file__).resolve().parents[1]
folder = base / "resources/data/content/srd-2024-bulk-07"
bundle = json.loads((folder / "review.json").read_text(encoding="utf-8"))
rows = bundle["records"]
candidates = [r for r in rows if r["quality"]["status"] == "validated_candidate"]
pending = [r for r in rows if r["quality"]["status"] != "validated_candidate"]
assert len(rows) == 797 and bundle["human_approvals"] == 0 and bundle["execute"] is False
groups = []
for group, ids in bundle["groups"].items():
    if not group.startswith("validated_candidate--"):
        continue
    members = [r for r in candidates if r["group"] == group]
    groups.append({"label": f"G{len(groups) + 1}", "group": group, "count": len(ids), "ids": ids,
                   "baseline_proposals": [r["baseline_proposal"] for r in members if r["baseline_proposal"]],
                   "human_approved": False})

def ledger(row):
    return {"id": row["id"], "kind": row["kind"], "name_en": row["source_evidence"]["languages"]["en"]["name"],
            "name_ru": row["source_evidence"]["languages"]["ru"]["name"],
            "reasons": row["quality"]["hard_errors"] + row["quality"]["attention"],
            "manifest": row["manifest"], "source_checksum": row["selection"]["checksum"],
            "projection_checksum": row["plan"]["projection_checksum"], "human_approved": False, "execute": False}

actions = collections.Counter("update" if r["baseline_proposal"] else r["plan"]["action"] for r in candidates)
reasons = collections.Counter(x for r in pending for x in r["quality"]["hard_errors"] + r["quality"]["attention"])
repairs = collections.Counter(x for r in rows for x in r["plan"]["normalized"]["content"]["normalization_repairs"])
result = {"bundle_checksum": bundle["bundle_checksum"], "source": "srd-2024", "export": bundle["export"],
          "adapter_version": 5, "source_total": bundle["source_total"], "selected": 797,
          "reused_screening_count": bundle["reused_screening_count"], "prior_bundle_checksum": bundle["prior_bundle_checksum"],
          "counts": bundle["counts"], "after_explicit_content_and_baseline_confirmation": dict(actions),
          "baseline_proposals_for_candidates": sum(len(g["baseline_proposals"]) for g in groups),
          "groups": groups, "deferred": [ledger(r) for r in pending], "overlapping_reason_counts": dict(reasons),
          "normalization_field_repairs": dict(repairs), "human_approvals": 0, "execute": False,
          "approved_now": 0, "live_import_authorized": False, "database_writes": 0}

def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

write(base / "docs/CONTENT_07_RESULT.json", result)
write(folder / "human-decisions.json", {"bundle_checksum": bundle["bundle_checksum"], "candidate_groups": groups,
                                      "deferred": result["deferred"], "human_approvals": 0, "execute": False})
group_table = "\n".join(f"| {g['label']} | `{g['group']}` | {g['count']} | {len(g['baseline_proposals'])} |" for g in groups)
equipment = [r for r in pending if r["kind"] == "equipment" and any(x.startswith("mechanics_differs_from_raw:") for x in r["quality"]["attention"])]
equipment_names = ", ".join(r["source_evidence"]["languages"]["en"]["name"] for r in equipment)
decision = f"""CONTENT-07 · bundle {bundle['bundle_checksum']}
Проверяющий / время / основание: __________
После вычитки EN/RU, имён, фактов и проекций v5 одобряю группы: G__
Для выбранных C: browse=true, copy=true, execute=false.
Отдельно принимаю перечисленные в human-decisions.json B policy/entry_id/digest
для выбранных групп: ДА / НЕТ. Для всех G1–G4 их 147 (141 null + 6 source-ammunition).
Все 245 отложенных записей исключить из этого решения.
Машинные переводы не считаю ранее проверенными; решение охватывает прочитанные переводы.
Фактический импорт этим решением не разрешаю."""
command_groups = ",".join(g["group"] for g in groups)
report = f"""# CONTENT-07 — массовая подготовка SRD 2024

**Обработаны все 797 записей: 189 equipment, 276 magic items, 332 spells.**
**После явных C и 147 B можно выбрать 552 записи: 318 update + 234 create.**
Ещё **245 отложены**, ошибок адаптера и нераспознанных baselines — **0**.
Сейчас одобрено **0**, `execute=false` везде. Импорт и миграции не выполнялись.

[Полное EN/RU ревью и diff](CONTENT_07_APPROVAL.html) ·
[компактные группы, точные B и список отложенных](../resources/data/content/srd-2024-bulk-07/human-decisions.json) ·
[машиночитаемый итог](CONTENT_07_RESULT.json).

## Что исправлено

- Адаптер v5 воспроизводит точные технические исправления из закреплённого evidence:
  **9** range/components, **23** material, **1** duration/concentration.
  Это извлечение заголовков с проверкой совпадения curated-полей, без интерпретации правил.
  Before/after и evidence входят в projection checksum. Исходные payload/checksum сохранены.
- **15** PDF-записей сохраняют собственный PDF/pages provenance без выдуманного upstream commit/URL;
  редкость извлекается из единственного точного заголовка. **14** ядов принимаются как отдельный
  source endpoint; число цены без единицы не превращается в gp. Все эти яды отложены.
- Поддержаны исходный ключ Luckstone со скобками и фиксированный урон Blowgun `1`.
- Consumer сохраняет `very_rare`, `artifact`, `varies`; `epic` остаётся отдельным старым значением.
  Для составной редкости исходная строка сохраняется в карточке/копии, вариант не выбирается автоматически.
  Неизвестная редкость остаётся `unknown`, а не `common`. Новых колонок/миграций не требуется.
- В существующих Item/Spell libraries сохраняются полные reference/локализация, категория источника
  и редкость; категории копий корректно фильтруются. Справочная дистанция заклинания берётся
  из источника, а не execution recipe. Предметы остаются без игровых профилей/слотов,
  заклинания — MANUAL, result=nothing, execute=false.
- Все **9** отсутствующих source-ammunition baselines теперь воспроизводимы как отдельная
  policy `legacy-equipment-missing-source-ammunition-v1`. Она требует точного B по ID/digest;
  прежняя null-policy не расширена. Extra fields, реальные правки и stale B по-прежнему запрещены.
  Из этих 9 лишь **6** входят в кандидаты; Longbow, Sling, Hand Crossbow остаются спорными по характеристикам.

Установленные v4 по-прежнему читаются и копируются с прежними approvals. Старые manifests
v4 используют прежнюю проекцию; v5 approvals не подходят v4. Existing copies не пересчитывались.
Прежние **160** selection/evidence/quality переиспользованы и сохранены в `prior_screening`;
повторялись только автоматические проверки новой проекции и текущего baseline.
Остальные **637** обработаны тем же pipeline. Архитектура и параллельные библиотеки не создавались.

## Одно групповое решение

| Группа | Точный идентификатор | Записей | Отдельных B |
| --- | --- | ---: | ---: |
{group_table}

Общий flag машинной локализации сохранён явно в имени magic-item групп и checks.
Он **не означает доказанную ошибку каждой строки** и не считается одобрением перевода.
Все 276 magic items требуют человеческого EN/RU решения; 42 из них дополнительно
отложены по конкретным замечаниям. У остальных 234 возможен один явный групповой C.

```text
{decision}
```

Команда ниже — только для выполнения **после явного решения человека**; она не запускалась:

```powershell
php -d memory_limit=1024M artisan compendium:unified-confirm-group B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --review=resources/data/content/srd-2024-bulk-07/review.json `
  --bundle-checksum={bundle['bundle_checksum']} `
  --group='{command_groups}' `
  --reviewer='<Имя>' --evidence='<Основание вычитки EN/RU и проекций>' `
  --languages=en,ru --copy --confirm --accept-legacy-baselines `
  --output=artifacts/content-07-approved
```

Можно выбрать часть групп; точные ID/B находятся в `human-decisions.json`.
Команда заново сверяет manifests/source/projection/baseline **всех выбранных членов до записи решений**.
Неизвестные/повторные группы, manual/rejected, stale B/проекция отклоняются.
Группы можно подтвердить одной командой; per-record receipts выпускает существующий confirm.
После всех четырёх групп получится **28 approved manifests <=20**, без импорта.

## Короткая очередь решений

Отложено **42 equipment + 42 magic items + 161 spells = 245 уникальных записей**.
Причины ниже пересекаются; их нельзя складывать как число записей.

| Семейство | Объём | Нужное решение |
| --- | ---: | --- |
| Усиление не явно в обоих языках | 100 | Проверить/дополнить EN/RU по источнику; текст не сочинён |
| Смысл structured damage | 68 | Проверить назначение урона/условия, даже для справочника |
| Числа EN/RU | 57 | Проверить повторы, словесные числа, единицы и полноту перевода |
| Нет official-reference evidence | 29 | Закрепить проверяемое свидетельство; включая 14 ядов |
| Характеристики equipment raw/curated | {len(equipment)} уникальных | Выбрать подтверждённые значения стоимости/веса/урона |
| Проза curated/raw | 14 | Вычитать точные отличия; автоматическое принятие запрещено |

Характеристики требуют решения для: **{equipment_names}**.
У ядов дополнительно отсутствует единица цены. Полные **245 ID с причинами и checksum**
есть в `human-decisions.json` и фильтре «Ручное ревью» HTML; групповой C их не включает.
Bag of Holding/Wish, 13 установленных пилотных записей, SRD 2014 и BG3 вне selection.
Artwork не копируется и не регистрируется; используются прежние neutral fallbacks.

## План массового импорта

1. Дать одно явное решение по G1–G4 (или выбранной части) и отдельно точным B.
   Выпустить approved manifests; исходные **40 manifests** полного остатка сохранить без approvals.
2. Пересчитать live diff approved manifests. Для полного выбора ожидается **318 update / 234 create**;
   это расчёт по текущему SELECT-only baseline, а не уже разрешённые операции.
3. Подготовить свежий проверенный recovery set и отдельный ограниченный permit для
   точной approved selection/plan checksums, с поддержкой create и v5. **Текущий CONTENT-05 writer
   остаётся закрытым и ограниченным старым пилотом из 13; этот пакет им применить нельзя.**
   В этой задаче gate не расширен. Новые миграции не выполнялись и не предлагаются как обязательный шаг.
4. После отдельного import-разрешения применить chunks транзакционно, сохранить ID updates;
   затем no-op повтор и сверка сохранности копий/персонажей/инвентаря. Новые игровые экземпляры не выдавать.
   Для частичного прогресса между chunks хранить результаты каждого подтверждённого плана;
   stale оставшиеся планы пересчитывать, а не продолжать вслепую.

## Проверки и границы

- **73 tests / 672 assertions — PASS**, целевой SQLite :memory: regression pipeline/import/gates/baseline/consumers.
- Отдельно **1 test / 8640 assertions — PASS**: все **797 реальных записей** проходят существующие
  ItemLibrary/SpellLibrary copy paths в SQLite :memory:. Trust исключительно синтетический внутри теста;
  **не человеческое одобрение** и не live import. Полные reference/EN/RU и neutral execution сохранены.
- Frontend **16 tests — PASS**, TypeScript + production build — PASS.
- **5 Chrome workflow-сценариев — PASS**: search/filter, inspect, copy/edit/reload, retry/denied,
  keyboard/focus, desktop/tablet/mobile; реальные React-компоненты, API-фикстуры SQLite,
  **не live браузерный импорт**. [Browser evidence](../artifacts/content-ux/browser-report.json).
- Pint целевых PHP — PASS. Standalone approval report — PASS: 797 строк, все группы/статусы, source-ID search, raw/curated и v5 rarity Inspector, desktop/mobile без overflow и JS errors. [Evidence](../artifacts/content-07-review/browser-report.json).
- Fingerprints всех **73 live tables** совпали до/после финальной подготовки;
  source data и CONTENT-06 files совпали. [Доказательство](../artifacts/content-07-final-verification.json).
  [Полный consumer прогон](../artifacts/content-07-consumers.json).
- Источник: commit `{bundle['export']['srd_commit']}`, export `{bundle['export']['library_version']}`.
  Редакция 2024 проверена; точная ревизия всего upstream 5.2.1 по-прежнему не доказана.
  `human_verified`/`full_semantic_review` не повышались. Машинные проверки не доказывают точность перевода/правил.

Воспроизведение в новый каталог:

```powershell
php -d memory_limit=1024M artisan compendium:unified-prepare-batch B:/BG3-Assets-Work/Output/Unified-DnD-Library `
  --all --reuse-review=resources/data/content/srd-2024-batch-01/review.json --output=<новый каталог>
```

Для изолированного consumer прогона задать `YTT_CONTENT07_SOURCE` и запустить
`php -d memory_limit=1024M vendor/phpunit/phpunit/phpunit --filter UnifiedMassConsumersTest`.
Без переменной полный export-тест пропускается; обычные целевые тесты используют собственные fixtures.
"""
(base / "docs/CONTENT_07_REPORT.md").write_text(report, encoding="utf-8")
(folder / "README.md").write_text(f"# SRD 2024 · CONTENT-07\n\n797 записей, 40 manifests <=20.\n552 кандидата после машинных проверок, 245 отложены; approvals=0, execute=false.\n\nBundle: `{bundle['bundle_checksum']}`.\n\n[Отчёт и план](../../../../docs/CONTENT_07_REPORT.md), [EN/RU/diff](../../../../docs/CONTENT_07_APPROVAL.html).\nhuman-decisions.json содержит точные группы/B и отложенные ID; это предложения, не receipts.\n", encoding="utf-8")
print(json.dumps({"candidates": len(candidates), "deferred": len(pending), "actions_after_confirmation": actions, "groups": len(groups)}, ensure_ascii=False))
