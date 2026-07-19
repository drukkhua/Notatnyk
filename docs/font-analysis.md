# Шрифты смет: чем реально набраны деловые документы США — топ-7 для Notatnyk

> Анализ 19.07.2026 под меню «Aa» (вид «Документ» + экспорт клиенту). Вопрос: не «какие
> шрифты красивые», а **какими шрифтами американский клиент привык видеть счета и сметы** —
> знакомое читается как «профессионально». Ограничения отбора: системная доступность на
> всех ОС (ноль бандлинга — [[keep-it-lightweight]]), полная кириллица (UA-валидация),
> **ровные lining-цифры** (смета состоит из цифр).

---

## 1. Что показало исследование

| Источник привычки | Шрифты | Почему это важно |
|---|---|---|
| **QuickBooks** (инвойс-стандарт США) | Только **Arial Unicode, Helvetica, Times New Roman, Courier** ([QBO.Support](https://qbo.support/what-fonts-can-i-use-if-i-create-a-custom-template-using-qb-online/)) | Миллионы американских инвойсов набраны ровно этим. Helvetica/Arial + TNR = «так выглядит счёт». |
| **Microsoft Word** | **Calibri** — дефолт 2007–2023, **Aptos** — с 2023 ([Wikipedia](https://en.wikipedia.org/wiki/Aptos_(typeface)), [heise](https://www.heise.de/en/news/Microsoft-Office-Wechsel-der-Standard-Schrift-auf-Aptos-beginnt-9729575.html)) | «Большинство офисов используют Calibri, потому что это дефолт» ([Emphasis](https://www.emphasis.co.uk/blog/the-best-fonts-for-business-documents/)). Aptos — от Стива Мэттесона, автора Segoe. |
| **Google Docs/Sheets** | «Sans Serif» = Arial; «Serif» = Times New Roman | Наша ЦА живёт в Sheets (voice-of-customer §1). |
| **Гайды по инвойсам** | Arial, Helvetica, **Verdana** — «самые распространённые»; Calibri — «для официального»; serif для печати — Times, Garamond ([Smallpdf](https://smallpdf.com/blog/best-fonts-for-invoices), [InvoiceGen](https://www.invoicegenfree.com/blog/how-to-customize-invoice-fonts)) | Verdana подтверждён как экранный стандарт читабельности. |
| **ОС клиента** | SF Pro (Apple), Segoe UI (Win), Roboto (Android) | То, что глаз клиента читает весь день, — «нативный» ноль-трение. |

## 2. Топ-7 → пресеты меню «Aa»

| # | Пресет | Стек (по убыванию) | Обоснование из §1 |
|---|---|---|---|
| 1 | **Современный** (дефолт) | SF Pro → Segoe UI → Roboto → Noto Sans | родной шрифт ОС клиента; самый «свежий» вид |
| 2 | **Строгий** | Helvetica → Arial → Liberation Sans | стандарт QuickBooks + Google «Sans Serif»: «так выглядит американский счёт» |
| 3 | **Офисный** ★новый | Aptos → Calibri → Carlito → Segoe UI | дефолт Word 2007–сегодня; миллиарды документов; Carlito — свободный метрический клон для Linux |
| 4 | **Дружелюбный** ★новый | Trebuchet MS → Segoe UI → Verdana | тёплый гуманист эпохи Windows (везде на Win+mac, полная кириллица) — для «дружелюбных» сфер: клининг, газоны, переезды |
| 5 | **Книжный** | Charter → Cambria → Sitka → PT Serif | читабельный serif Office-эпохи; наша замена Georgia |
| 6 | **Деловой** | Times New Roman → Liberation Serif | стандарт QuickBooks + юридических документов + Google «Serif» |
| 7 | **Экранный** | Verdana → DejaVu Sans → Tahoma | «most common» в гайдах; рисован для экрана, максимальный x-height |

## 3. Кого исключили и почему (честно)

- **Georgia** — в каждом втором гайде, но **минускульные цифры** прыгают ниже строки:
  для документа из цифр дисквалификация. Роль «тёплый serif» закрывает Charter/Cambria (№5).
- **Garamond** — рекомендуют для печати, но системные версии **без кириллицы**; EB Garamond
  требует бандлинга. Мимо ограничений.
- **Roboto / Open Sans / Lato** (веб-SaaS-инвойсы FreshBooks/Square) — на десктопах их
  **нет**: пресет был бы миражом (падал бы в Segoe/Helvetica). Единственный честный путь —
  вшить WOFF2 (~40–80 КБ) — отложено; вернуться, если бренд-шрифт понадобится лендингу.
- **Proxima Nova / Gotham** (любимцы американского брендинга) — **платные**. Нет.
- **Courier** (четвёртый шрифт QuickBooks) — моноширинная «чековая» эстетика; не для
  «красивой сметы». В морозилку как возможный пресет-стиль «Receipt» (прикольно, не сейчас).

## 4. Примечания реализации

- «Офисный»: на Mac **без установленного MS Office** Aptos/Calibri отсутствуют → карточка
  честно упадёт в Segoe UI/системный. У ЦА с Office (большинство деловых) — настоящий Calibri.
- Все стеки завершаются родовым `sans-serif`/`serif` — CSS-страховка на любой экзотике.
- Дефолт остаётся «Современный»: клиент открывает смету на телефоне (М-первичность) —
  родной шрифт ОС там выигрывает у любого «бумажного».
- Реализация: `DOC_FONTS` в `main.js`, выбор в config.json, стек уезжает в экспорт
  через `:root{--doc-font}`.
