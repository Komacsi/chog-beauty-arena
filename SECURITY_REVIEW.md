# Проверка безопасности Chog: Beauty Arena

Текущая редакция включает отзыв/замену keeper через Safe, аварийные возвраты и замену Ganache на Anvil. Свежий npm audit: 0 известных уязвимостей. 21 октября 2026 (Москва) проверен созданный владельцем Safe: версия 1.5.0, порог 2 из 3, все три адреса подписантов совпадают, enabled modules отсутствуют, code hashes подходят арене. Указанный keeper — отдельный EOA с наблюдаемым балансом 10 MON. Публичные адреса сохранены в .env.example, снимок блока 115176123 — в security/launch-wallets.json. 22 октября владелец завершил настройку encrypted keystore и пароля на VPS; оба файла root:root 0600, содержимое пароля агент не читал. Keeper остаётся выключенным без адреса/блока арены; ограничения запуска ниже сохраняются (security/keeper-credentials.json).

Дата: **20 октября 2026, Москва**. Статус: **реальные средства пока не включать**.

Проверены исходники на базе локального 8bc3c84 / GitHub fc18d7e6ebf3bf55309ea7d9cbc04c2c42579c9e и последующее обновление протокола по запросу владельца: контракт, браузерная отправка ставок, timelock, keeper, HTTP/API, зависимости и эксплуатационные риски. Это внутренняя проверка с воспроизводимыми сценариями, не независимый аудит и не доказательство отсутствия всех уязвимостей. Реальная арена не развёрнута; транзакций в Monad mainnet не отправлялось.

## Итог

Управление использует официальный Safe 1.5.0: минимум две подписи, без enabled modules; runtime proxy/singleton закреплены по code hash. Контракт отсекает EOA, поддельные контракты и Safe с одной подписью. Отзыв одной операцией отмечает незавершённые матчи для возврата без перебора участников/истории. Публичный settle доступен сразу; участники забирают свои депозиты через claim без комиссии. Новый keeper не может продолжить старые прерванные матчи. Завершённые результаты/claims сохраняются. Обычная смена keeper не прерывает действующие матчи.

Регрессии используют настоящие SafeL2/Proxy bytecode из @safe-global/safe-smart-account 1.5.0 и подтверждения нескольких локальных владельцев. Проверяются недостаточный кворум, запрет прямого администрирования keeper/одним владельцем, смена ключа, отзыв нескольких матчей, выплаты завершённого матча после отзыва, отмена раскрытого незавершённого матча и двухэтапная передача управления. Renounce запрещён.

Приложение отражает паузу и предлагает Finalize refunds. Keeper прекращает работу при потере роли; кошелёк загружается из encrypted keystore, raw key в env отвергается. Подготовлены unsigned Safe Transaction Builder JSON, systemd-шаблоны разделения keeper/monitor и read-only монитор. Это не HSM: работающий процесс содержит ключ, root/process compromise остаётся опасным. Кворум Safe может отменить незавершённый матч или назначить злонамеренный keeper; до обнаружения взлома защита независимыми keeper по запросу владельца не добавлена. Новая арена/сервисы не развёрнуты.

| Пункт | Статус | Последствия |
| --- | --- | --- |
| SEC-01: некорректный ciphertext / выборочное раскрытие участником | Исправлено в модели доверенного сервиса | Нераскрытые записи не влияют на результат и возвращаются отдельно; прямое раскрытие участником запрещено. Доверие к сервису описано ниже. |
| SEC-02: несколько кошельков одного участника | **Принят владельцем проекта** | Каждая NFT — один голос без ставки за бой; только первая CHOG-ставка кошелька добавляет один голос, последующие участвуют в выплатах без голосов. Минимум каждой ставки 5000 CHOG. Не является причиной блокировки запуска. |
| SEC-03: доступность и масштабирование | Проверены восстановление, нагрузочная модель и доставка уведомлений; live-репетиция остаётся | Владелец принял риск большого наплыва и отказался от расширения мониторинга боёв. Требуется проверка реально подключённого keeper перед открытием средств. |
| SEC-04: внешние активы и готовность окружения | CHOG проверен по байткоду и fork; риск отсутствия исходников принят владельцем | Точный код и состояние CHOG проверяются preflight. Исходники не верифицированы; реальное тестовое развёртывание/полный цикл ещё нужны. |
| SEC-05: смена кошелька / доверие API | Исправлено | Перед подписями проверяются кошелёк и сеть; NFT/beacon для шифрования читаются из контракта. |

В RELEASE_STATUS SEC-02 и узкий риск CHOG-SOURCE перенесены в acceptedRisks по прямому решению владельца. SEC-03 и оставшаяся часть SEC-04 остаются условиями готовности live. Trust model — Safe-governed authorized revealer. Guard ограничивает штатное приложение, но не мешает третьим лицам самостоятельно развернуть исходники.

## SEC-01: некорректный голос больше не отменяет матч

По уточнённому запросу владельца: участник отправляет encrypted commit; автоматическое раскрытие выполняет приложение; нераскрытый голос исключается, его ставка возвращается целиком без комиссии. Штраф/конфискация не введены.

Контракт принимает revealVote только от текущего адреса revealer; начальный адрес задан в constructor, смена и отзыв доступны управляющему Safe. Участник, owner и treasury не получают право раскрытия автоматически. Commitment по-прежнему связывает исходный кошелёк, сеть, контракт, раунд, сторону, NFT, сумму и salt. Вызвать раскрытие своей записи вручную после просмотра других нельзя.

Keeper расшифровывает именно опубликованный ciphertext, проверяет signed drand beacon, commitment и домен, затем отправляет matching reveal. Некорректные записи пропускаются. Если раскрылись все записи, settlement доступен после unlock; иначе — после существующего reveal deadline. По окончании срока считаются только раскрытые голоса и банки. Нераскрытые суммы резервируются отдельно для claim без комиссии. Один испорченный голос ещё может задержать финализацию до deadline, но не отменяет результат остальных.

Если не раскрылась ни одна запись, результат 0–0, все положительные ставки возвращаются, draw/победы/поражения не начисляются. Если раскрылась лишь часть корректных голосов, именно эта часть определяет результат: частичный сбой сервиса способен изменить победителя. После deadline позднее раскрытие отклоняется.

**Граница доверия:** контракт не доказывает корректность ciphertext. Назначенный сервис может цензурировать раскрытия и влиять на результат/распределение выигрыша; компрометация его ключа опасна для честности игры. Он не может напрямую забрать чужой claim или изменить его подписанный выбор, но через результат может изменить, какие участники получат выигрыш. Это не trustless решение. Управляющий Safe может отозвать ключ, прервать незавершённые матчи с полным возвратом без комиссии и назначить новый keeper. Уже завершённые результаты и выплаты не отменяются. До подтверждения отзыва скомпрометированный keeper ещё может влиять на результат; защита от этого до обнаружения по запросу владельца не добавлена.

Сразу отклоняются неверная сумма/срок/владение/размер ciphertext и прочие проверяемые условия. Универсально распознать неверное шифрование на стадии commit без дополнительного доказательства нельзя; текущая защита работает через исключение при раскрытии. Полноценная проверка шифрования контрактом остаётся отдельным криптографическим проектом.

Регрессии: испорченный голос холдера не отменяет честный результат 2–1; funded malformed entry возвращается вне банка победителей; ручной reveal участника запрещён, поздний reveal запрещён; полный отказ сервиса возвращает все ставки без статистики. Интеграционный тест использует настоящую tlock-криптографию, подписанный fixture drand и локальную EVM: keeper сам раскрывает три корректных записи, пропускает мусор и завершает матч без второй транзакции участников.

## Публичный staging на Netlify

Добавлена отдельная сборка dist/netlify с проверкой списка допустимых файлов:
только HTML/CSS/JS, логотип, placeholder и 10 изображений. Репозиторий, ABI-файлы,
SQLite, .env и keeper credentials не публикуются. /api/* проксируется Netlify
на фиксированный HTTPS origin VPS; JSON остаётся no-store. POST принимает точный
ARENA_WEB_ORIGINS либо прежний origin текущего хоста, но не произвольные Netlify
сайты, wildcard или поддельный Forwarded-Host. Unit/HTTP-регрессии проверяют это.
Это проверка browser origin, не запрет прямых клиентов и не замена onchain-валидации.

Подготовленный Caddy публикует только /api/*, оставляя приложение/SQLite на
loopback. Скрипт настройки делает согласованную резервную копию и отдельный
release с откатом при ошибке команд. Бесплатный sslip.io добавляет зависимость от
внешнего DNS; его TLS проверяется обычным способом, без bypass. После явного
согласия владельца 22 октября API опубликован на chog-api.72-56-98-23.sslip.io,
интерфейс — https://chog-beauty-arena.netlify.app на подтверждённом Free-тарифе.
Проверены сертификат Let's Encrypt, HTTP 200 страниц/config/state, no-store,
создание/отмена заявки и смена demo persona через Netlify, размеры загруженных
изображений и отсутствие ошибок консоли. Хеши bundle/vendor/изображения с VPS
совпадают с артефактом; в Windows CLI эти три загрузки дали таймаут, хотя браузер
и внешний VPS загрузили их. Старое демо глубоко сравнено с исходным снимком.
На момент публикации keeper/monitor были отключены, credentials не добавлены. Настройка credentials завершена позднее, 22 октября; keeper пока не запущен. Подробности публикации —
security/netlify-staging.json. Real-funds guard остаётся false; SEC-03/04 не закрыты.

## SEC-03: доступность приложения и раскрытия

Подтверждено публичным RPC https://rpc.monad.xyz: запрос событий за 500 блоков возвращает HTTP 413; за 100 проходит. Keeper использовал 500. Исправлено на максимум 100 блоков, включая последнюю неполную порцию; добавлена регрессия.

Ранее ожидание receipt могло остановить следующие матчи. В production-пути теперь SQLite-журнал сохраняет подписанные байты до broadcast. После таймаута/перезапуска проверяются все известные хеши и повторяются те же байты; новый nonce до разрешения предыдущего не выдаётся. Через 120 секунд допускается замена с теми же nonce/вызовом и повышенной комиссией в пределах лимита. Подтверждение требует трёх блоков и совпадения canonical block hash; неизвестное потребление nonce останавливает новые подписи. **Таймаут не отменяет отправленную транзакцию.** RPC ограничен 15 секундами; прежний processRound оставлен для изолированных регрессий, рабочий CLI использует keeperCycle.

Параллельные /api/state?fresh=1 раньше запускали независимые обходы истории. Теперь общий in-flight запрос объединяет обращения; принудительная свежесть ограничена интервалом 1 секунда, обычный cache — 10 секунд. Тест со 100 одновременными fresh-запросами подтверждает один вызов загрузки; отказ RPC освобождает блокировку для повтора. Это не защита от распределённого DDoS.

21 октября добавлены отдельные постоянные индексы событий keeper/сайта, атомарный курсор, очередь незавершённых записей и лимиты работы. Диапазоны не более 100 блоков уменьшаются при переполнении RPC; максимум 20 попыток диапазона за синхронизацию. При изменении хеша контрольного блока публичный индекс строится заново, журнал транзакций сохраняется. Сайт обновляет не более 20 грязных снимков за проход, учитывает NFT Transfer для устаревших заявок и не читает всю историю матчей/заявок через RPC. История выплат кошелька проверяется страницами по 50 собственных боёв. Systemd-шаблон keeper имеет flock и отдельный private StateDirectory; публичный heartbeat позволяет заметить остановку, зависшую транзакцию, лимит комиссии и отставание индекса без доступа к ключам.

Проверены локальные сценарии: восстановление тех же signed bytes/nonce после неопределённой отправки, fee replacement, чужой nonce, перезапуск индекса, сбой RPC и reorg, дробление HTTP 413, 1000 некорректных записей с обработкой по 10 за цикл и продвижением другого матча. Интеграция с настоящей timelock-криптографией и локальной EVM перезапускала keeper после каждого цикла; раскрытие, итог, общая выплата 15000 gross / 150 fee / 14850 net, возврат некорректных 5000 и нулевой остаток банка прошли. Доказательства: security/durable-keeper.json. Это не замер пропускной способности mainnet.

Исторический снимок 21 октября: на VPS владельца подготовлен закрытый staging: Ubuntu 24.04, Node 24.22.1 и Caddy 2.11.7; сайт работает под chogweb, код принадлежит root, слушатели приложения/прокси привязаны только к 127.0.0.1. Первая конфигурация Caddy была исправлена после проверки ss: для ограничения интерфейса нужен явный bind, а не только адрес сайта. Keeper и monitor установлены, но отключены; ключи keeper не загружались. Домена и публичного HTTPS нет. На самом Linux прошли 11 durable-регрессий, валидация units/Caddy, 50 HTTP-запросов (10 одновременно, p95 57 мс внутри VPS), отказ тела 20 КБ с HTTP 413, сохранение базы после рестарта и запуск из резервной копии под chogweb в одноразовом каталоге. Production npm audit: 0 findings. Снимок — security/vps-staging.json. Filebase был недоступен по таймауту, Pinata прошёл; NFT_IPFS_PRIMARY меняет только порядок двух фиксированных HTTPS-шлюзов, произвольные URL не добавлены.

Netlify/публичный HTTPS теперь настроены. Остаётся внешняя доставка уведомлений, настройка реального keeper и измерение достаточной скорости раскрытия на реальных RPC/сети. Один outstanding nonce и три подтверждения сознательно ограничивают скорость: до запуска нужно проверить целевую нагрузку в часовом reveal window. Независимый monitor пока проверяет ограниченную историю и явно сообщает COVERAGE_LIMIT; охват нельзя считать полным. Поэтому SEC-03 остаётся открытым по эксплуатационной готовности. Settle/claim требуют транзакций: при отключённом keeper/сайте деньги не отправляются сами.

## SEC-04: реальные CHOG и NFT

Проверка только чтением, Monad chain ID 143, блок **114856368**:

- CHOG: Chog, CHOG, 18 decimals. Runtime 45 байт — **EIP-1167 minimal proxy**, реализация 0x7f64ccfeb3e3afd7691ea0ef404e947786cefae8. Нулевые EIP-1967 слоты не означают отсутствия proxy. Owner() недоступен и не доказывает отсутствия других административных функций.
- Genesis: Chog Genesis, supply 1969, runtime 17264 байта. Прочитан опубликованный в MonadScan исходник ChogMint; полный независимый аудит коллекции не проводился. Code hashes и результаты чтения сохранены в security/asset-snapshot.json.
- На странице реализации CHOG проверенный исходник не получен. Это не доказывает наличие эксплойта; поведение и полномочия нельзя объявить полностью проверенными.

Повторная проверка 21 октября: хеш реализации совпал с предыдущим снимком. Sourcify для chain 143 вернул 404 / match:null; MonadScan вернул HTML без полученного верифицированного исходника. Из байткода извлечён IPFS CID метаданных QmVZjs5h5rhtLoV82CyLhVbL24jNNs3tbokRkhdpxcqcDU, но Filebase завершился таймаутом, Pinata вернул 403, ipfs.io/dweb.link — 429. Это ограничения доступа, не доказательство отсутствия исходника. Снимок — security/chog-source-status.json. Для завершения проверки нужен доступный исходник с воспроизводимым совпадением байткода/метаданных; SEC-04 не закрыт.

**Повторный локальный fork блока 114860268 прошёл с протоколом 7:** реальные CHOG/NFT, два NFT-голоса, три первые ставки по 5000 CHOG, повторная выигрышная ставка 10000 CHOG и некорректная ставка 5000. Результат 3–2. Сумма выигрышных ставок первого кошелька 15000 CHOG даёт один gross 18750 / fee 187.5 / net 18562.5; второму кошельку gross 6250 / fee 62.5 / net 6187.5. Нераскрытые 5000 возвращаются без комиссии. Treasury получает 250, остаток банка 0. Все транзакции локальные. Результат — security/fork-result.json, protocolVersion 7.

Последний повтор выполнен в одноразовой Anvil 1.7.1 EVM, chain ID 1337. Между native fork-узлом и upstream установлен локальный шлюз только для чтения; тест подтверждает отказ broadcast/admin методов до обращения к upstream. Узлы слушают только 127.0.0.1. Использованы локальное impersonation публичных адресов и фиктивный MON; ключи пользователя не читались. Раскрытия в этом fork-сценарии ручные, без drand. Для совместимости отсутствующий в ответе Monad массив withdrawals нормализован в пустой. Это проверка активов в одном снимке Shanghai EVM, **не проверка консенсуса/gas Monad**, будущих административных изменений или полной криптографии.

Перед live: установить модель доверия внешнему токену, проверить доступную реализацию и провести полный цикл с новым контрактом в подходящем тестовом окружении; подготовить production keeper и аварийный доступ к settlement/claims.

## Проверка средств и состояния

Локальная EVM проверяет:

- Только исходный участник получает выплату; owner/treasury не могут получить её за него. Повторный claim, подмена кошелька/раунда/сети/NFT и повторное раскрытие отклоняются.
- Gross считается до индивидуальной комиссии 1%; draw, one-sided bank и отмена возвращают ставку без комиссии. Treasury получает только комиссии уже полученных выплат; вывод не затрагивает банк другого раунда.
- Вредоносные callbacks токена при deposit/claim получают ReentrancyGuardReentrantCall; дополнительного списания/получения не происходит.
- Налог во входящем переводе откатывает токены, entry и счётчики. Отказ исходящего перевода откатывает claimed и комиссию: участник может повторить claim после восстановления переводов.
- Восемь последовательных сценариев с разными сторонами, суммами и wei-округлением сохраняют баланс: выплаты плюс комиссии не превосходят банк; остаток соответствует целочисленной пыли. Это ограниченная матрица, не исчерпывающий fuzzing.
- Передача активной NFT не снимает блокировку; удаление NFT в mock-коллекции не мешает settlement/выплатам. Чужая заявка, повторное принятие/отмена и повторное начисление статистики отклоняются.

Управляющий Safe не может менять завершённый результат, комиссию/treasury, реализацию арены или выводить банки. Он может отменять незавершённые матчи с полным возвратом и менять keeper: это существенное доверие к кворуму владельцев. Settlement/claim не перебирают всех участников. Прямо отправленные токены и пыль могут остаться заблокированными; право владельца забрать весь баланс не добавлялось.

## Браузер, API и инфраструктура

Исправлена гонка смены кошелька во время шифрования/approval: используются захваченные signer/account и идентификатор сессии, проверяются текущие accounts/chain перед запросами подписей. Тесты моделируют смену на обоих этапах и отсутствие commit после неё. NFT-пара и drand beacon теперь читаются из getRound через wallet provider вместо API.

HTTP проверяет размер тела по байтам, отклоняет null/массив вместо объекта; лимит 8192 байта. Добавлены сроки приёма заголовков/запроса 10/15 секунд, ограничения заголовков и запросов на keep-alive соединение. Проверены malformed JSON, oversized ASCII/UTF-8, параллельные запросы, чужой Origin, traversal за пределы public и недоступность deployment API. На live сервер не принимает игровые POST вместо подписанных транзакций.

Просмотрены экранирование надписей, CSP, статические маршруты, cookie-флаги, отсутствие plaintext side/salt до раскрытия. В отслеживаемом дереве не обнаружены .env, keystore или шаблоны приватных ключей; это не полное сканирование внешних хранилищ/истории. CI ограничен contents: read и 10 минутами выполнения.

Production ещё требует HTTPS/reverse proxy с ограничениями соединений/запросов, защищённое окружение keeper, наблюдаемость и восстановление. Компрометация фронтенда способна подменить действия до подписи; чтение раунда из контракта не защищает от подмены JavaScript. Доверие к threshold drand остаётся — см. [модель безопасности](https://docs.drand.love/docs/timelock-encryption/#-security-assumptions).

## Зависимости и инструменты

Lockfile: solc 0.8.30, OpenZeppelin 5.4.0, ethers 6.17.0, tlock-js 0.9.0. Tmp закреплён на 0.2.7; основания предыдущего исправления: [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65), [GHSA-7c78-jf6q-g5cm](https://github.com/advisories/GHSA-7c78-jf6q-g5cm).

Ganache удалён и заменён официальным @foundry-rs/anvil 1.7.1; удалены 365 пакетов. Тестовая EVM использует native binary из npm optional dependency нужной платформы, без postinstall. Тесты владения, выплат, раскрытия, Safe, отзыва/замены и аварийных возвратов перенесены на Anvil. Исторический drand fixture сохраняет точное время через timestamp interval и явный next-block timestamp.

Свежий npm audit обновлённого дерева, включая Anvil и Safe 1.5.0, успешно получен 20 октября 2026 (Москва) и сохранён в security/npm-audit.json: **0 известных уязвимостей** во всех категориях, 61 пакет в lockfile. Предыдущие 36 findings (5 critical, 22 high, 8 moderate, 1 low) относились к удалённому Ganache и его зависимостям. Это результат npm advisory database, а не независимый аудит native binary Anvil, библиотек или приложения.

Обычные запросы audit периодически завершались ECONNRESET. GET registry и полный bulk POST через Node fetch проходили; после prefer-online и maxsockets=1 официальный npm audit дважды получил полный отчёт, но последующий контроль вновь показал обрыв. Поэтому npm run audit:security запускает штатный npm audit и повторяет весь запрос при транспортном сбое максимум три раза (таймаут процесса 45 секунд, запроса 20 секунд). Это покрывает обрыв при чтении тела ответа, на котором встроенные повторы npm не помогали. Новая команда проверена реальным запуском: получен полный свежий отчёт. Три регрессионных теста проверяют повтор, сохранение exit 1 при уязвимостях и отказ выдавать неполный ответ за успешный аудит.

Точная причина обрывов npm не установлена; постоянное устранение внешних сетевых сбоев не гарантируется. Registry, TLS, системный proxy и глобальные настройки npm не изменены. Exit 0 — полный отчёт без замечаний; exit 1 — полный отчёт с уязвимостями; exit 2 — отчёт не получен. Ganache заменён явным изменением зависимостей, audit fix --force не применялся. Для native Anvil выставлен NO_PROXY только в дочернем процессе и только для локальных 127.0.0.1/localhost: без этого Windows system proxy возвращал 503 до попадания запроса на локальный fork-шлюз.

Добавлена сборка npm run build:runtime: отдельный каталог с production-зависимостями и явным набором файлов. Anvil, Safe test artifacts, solc и esbuild отсутствуют; секреты и исходная база демо не копируются. Каталог назначения должен быть новым. Локально установлены 45 production-пакетов; scripts/check-runtime.mjs подтвердил запуск сервера, доступность страниц/изображений, 10 NFT, пустое изолированное состояние и активный запрет live deployment. Для воспроизводимой локальной установки tarball-пакеты сверены по SHA-512 из lockfile и помещены в отдельный кэш; затем установка прошла offline. CI также собирает и проверяет runtime отдельно.

Anvil — только тестовый узел: не публиковать как production RPC и не использовать с production-ключами. Проверка не включает независимый аудит native binary/библиотек, пенетест реального хостинга, нагрузку mainnet или формальную верификацию. SEC-03/04 не закрываются одним чистым npm audit.

## Воспроизведение и демо

После обновления голосования прошли **все регрессионные тесты**, включая NFT-группы, повторные ставки, объединённые выплаты и комиссия один раз с суммы выигрышных ставок и запрет upstream broadcast/admin методов. Синтаксические проверки, Solidity-компиляция, сборка браузера, runtime smoke и повторный fork прошли. Предыдущая редакция проходила 82 теста; игровые сценарии не удалены. Зелёный CI и чистый npm audit не означают готовность к реальным средствам.

    npm ci --ignore-scripts
    npm run check
    npm run build
    npm test
    npm run build:runtime
    node scripts/check-runtime.mjs dist/runtime
    node scripts/security-assets.mjs
    node scripts/security-fork.mjs
    npm run audit:security -- --json

Security-скрипты обращаются к сети только за чтением. Fork — opt-in проверка вне CI; отчёт записывается по переданному CLI-пути. Для повторения после изменения цепочки учитывайте block сохранённого результата: скрипт по умолчанию берёт актуальный снимок.

Демо сохранена отдельно, используется прежний ARENA_STATE_DIR. Согласованная SQLite-копия demo-after-anvil.sqlite подтверждает совпадение с прежним snapshot: четыре завершённых раунда, десять заявок, те же пользователи, владельцы и балансы. История не очищалась; HTTP/EVM/runtime-тесты используют изолированные состояния. Демо снова запущена на localhost:3104 с двухминутными раундами, live-контракт — с 24 часами. Новые демо-раунды и live-ревизия используют protocolVersion 7: один голос на NFT, совместимые CHOG-ставки с одним голосом от первой ставки и одной объединённой выплатой за бой. Старые демо-раунды остаются на записанной версии. Старые результаты/выплаты и правила ранее созданных раундов не переписываются.


## Поиск NFT и отложенная загрузка изображений

Профиль больше не ограничен десятью примерами: live читает tokensOfOwner и balanceOf фиксированной коллекции в одном блоке, проверяет полноту/уникальность ID и смену кошелька/сети. Функция tokensOfOwner подтверждена чтением Monad; стандартный ERC721Enumerable у этой коллекции отсутствует. Изображения не участвуют в проверке владения и не блокируют получение списка.

Публичные GET /api/nfts/ID и /api/nfts/ID/image ограничены ID 1–1969 и единственным контрактом. Пользователь не может выбрать контракт или URL. Сервер читает tokenURI, допускает только IPFS-пути без traversal и обращается к фиксированным HTTPS-шлюзам без перенаправлений. Ограничены параллелизм/очередь, время, размер JSON (256 KiB) и изображения (8 MiB); SVG/HTML в удалённых изображениях запрещены, тип определяется по сигнатуре байтов. Частичные ответы не принимаются за полные. Метаданные не скачивают изображение. Используются общий in-flight запрос и файловый кеш вне базы демо. Это не production DDoS-защита и не отменяет SEC-03.

Проверка реального холдера вернула 6 ID: 6,32,53,299,942,1445; пять из них отсутствуют в десяти примерах. Метаданные двух новых NFT получены без загрузки изображений; затем отдельно загружено одно WebP. Браузерная проверка изолированной демо показала все шесть карточек, отложенную загрузку, выбор NFT вне примеров и создание заявки. Основная история демо не использовалась для этих тестов.

## Подготовка развёртывания, 22 октября 2026

Read-only RPC estimateGas успешно выполнил constructor текущей сборки с заданными
CHOG, коллекцией, treasury, keeper и Safe: 3 728 776 gas. Иллюстративный бюджет
с запасом 20% по gas units и текущим maxFeePerGas — 0,903855464 MON. Комиссия
может измениться; это не отправленная транзакция и не разрешение запуска. Safe
повторно прошёл проверку 2 из 3, keeper — EOA с 10 MON. Отчёт с параметрами
и хешами — security/deployment-preflight.json; повтор — scripts/deployment-preflight.mjs
после npm run compile. Для оценки использован treasury как предполагаемый
deployer; выбор этого аккаунта владельцем ещё не подтверждён.

Keystore и пароль установлены root-only после скрытого ввода владельцем. Проверялись
только metadata файлов и статус службы/пустых адреса и блоков конфигурации. Live
keeper, доставка внешних уведомлений, проверка mainnet throughput и совпадающие
исходники CHOG по-прежнему не подтверждены. SEC-03/04 остаются открытыми.

Для уведомлений владелец выбрал Telegram. Добавлены sender с ограниченными публичными
полями, persistent deduplication, напоминанием раз в час и сообщением восстановления.
Отдельный monitor получает только bot credential; keeper credentials ему не доступны.
Подготовлен ручной root TTY helper: скрытый токен, проверка бота, одноразовый код
для личного чата, тестовое уведомление и exclusive config 0600. Владелец получил
тестовое сообщение и подтвердил его снимком; файл настроек root:root 0600. Код
монитора установлен отдельным release с резервной копией и проверкой systemd;
игровые записи/пользователи сохранились. Сам monitor пока не запущен без арены: его
реальное уведомление и внешний монитор VPS ещё нужны (security/telegram-staging.json). См. ops/TELEGRAM.md;
само наличие кода не закрывает SEC-03.


## Operational validation update, 22 October 2026

The isolated monitor unit produced an intentional bootstrap alert; Telegram acknowledged it and delivery state persisted. Its timer remains disabled. Independent HetrixTools monitors the public API health route from three locations with Telegram contact selection. A controlled missing-keyword test transitioned DOWN and back Online without stopping the app. Human receipt is tracked separately. Direct Netlify monitoring was rejected by the service, so frontend availability is not covered. See ops/MONITORING.md and security/operational-readiness.json.

The health-only release preserves demo records and the closed release guard. Live health fails closed on unavailable, malformed, stale or unhealthy keeper heartbeats and exposes no credential or journal content. All 136 local Node tests passed. Eleven durable recovery regressions also passed in an unprivileged, network-isolated VPS unit. The VPS decrypted 32 historical-fixture ballots (mean 106 ms, p95 112 ms) and rejected 1000 malformed entries; this excludes RPC/signing/gas/confirmation throughput and does not close SEC-03.

The fresh asset snapshot at block 115460204 confirms the recorded code hashes. Sourcify's completed similarity search returned no_similar_match_found for the CHOG implementation; additional bounded IPFS gateway and provider lookup attempts returned no verified metadata. This does not prove global source unavailability. No matching source was obtained, so administrative/transfer powers remain incompletely reviewed and SEC-04 stays open. No real transaction was sent. Earlier notes describing all host/alert work as outstanding are superseded only for the specifically tested items above.


## Keeper load and expected audience, 22 October 2026

Production code was not changed. A network-isolated VPS timing model exercised 1,000 unique valid timelock entries across ten rounds using the real keeper, index and signed journal. All opened at 32 ms modeled RPC, including a scenario with 1,000 malformed entries, outages, ambiguous accepted broadcasts and restarts. At 250 ms the conservative model opened 589 and excluded 411 valid entries at the one-hour deadline. This is a capacity risk, not a mainnet throughput measurement. Actual local EVM execution separately opened 128 paid entries and 200 NFT votes, settled four rounds and checked all claims/fees/refunds exactly.

The owner then specified a maximum expected audience of 50 people and accepted the large-influx risk without requesting optimization. A separate 100-entry / ten-round model at 250 ms completed every reveal and settlement/index update in 672 modeled seconds. This is a two-entry-per-person reference, not an enforced entry limit or a guarantee for unlimited bets/groups. No broad SEC-03/04 waiver or real-funds release was made. See ops/KEEPER_LOAD.md and security/keeper-load-summary.json for evidence, source hashes, methodology, serial-latency conservatism and exclusions.

## CHOG bytecode review completed, 22 October 2026

The bounded deployed-bytecode and adversarial local-fork review passed at block 115693565, with the previously recorded implementation code hash unchanged. Transfers preserved exact amounts without token tax in the checked paths. Reinitialization, unauthorized role changes, unknown administrative selectors, overspending, unauthorized allowance use and permit replay were rejected. The fixed proxy, dispatcher, initializer, graduation restriction and external-call instructions were examined. See ops/CHOG_REVIEW.md and security/chog-bytecode-review.json for the actual scope and reproduction command.

This supersedes earlier statements that CHOG administrative/transfer behavior had not been examined: those paths now have bounded bytecode and fork evidence. Matching Solidity/metadata source was still not obtained; sourceVerified remains false, SEC-04 is not fully closed, and SEC-03 plus the real-funds guard are unchanged. No mainnet transaction was sent.

The owner explicitly declined expanding battle monitoring. No such change was made: existing monitoring scans only the latest 200 rounds, so older actionable rounds may not be covered. Existing API/Telegram infrastructure monitoring remains as documented in ops/MONITORING.md.

## CHOG follow-up decision preparation, 22 October 2026

Additional original-source retrieval attempts did not produce matching source, including the creator Curve, public repository branches and the repository referenced in a Beosin report. The Beosin report was not matched to this deployment. See ops/CHOG_REVIEW.md and security/chog-source-followup.json; sourceVerified remains false.

The deployment preflight now rejects anything other than the exact bytecode-reviewed CHOG proxy/implementation and controller/pool/initialized/graduated/18-decimal state. It reads asset state at one recorded block and checks uncached block headers around the reads. It does not continuously monitor battles, defeat a dishonest RPC or prevent a later chain/state change. An actual read-only check passed at block 115700747; a new complete local game fork with real CHOG/NFT passed at 115700762. No mainnet transaction, signer or secret was used. The preflight is an additional safeguard, not source verification or a security proof.

The owner explicitly answered “Да, принимаю этот риск для проверенной реализации CHOG” after being shown the concrete bytecode/fork/preflight alternative and source limitation. Acceptance is recorded as CHOG-SOURCE in RELEASE_STATUS and security/chog-release-decision.json. The narrow source-provenance condition is closed by accepted risk; sourceVerified remains false. This does not close the remaining deployment/rehearsal portion of SEC-04, SEC-03 or enable real funds. The source-verification path remains available if the original author publishes matching inputs. Earlier source-only blocking statements above are historical and superseded by this narrow decision.

## Deployment address confirmation, 22 October 2026

The owner explicitly confirmed `0x1bED50dC4d93C8b110589Ae55d25eC8e3872bB0D` both as the wallet paying deployment gas and as the immutable recipient of the 1% payout fee, after being offered the Safe alternative and informed that treasury cannot be changed after deployment. The fee recipient is this individual signer, not a 2-of-3 withdrawal policy. Safe governance and the separate keeper retain their previously supplied addresses. See security/deployment-addresses.json. This supersedes the earlier unconfirmed-deployer note, but confirms address selection only: no deployment was signed/broadcast and real funds remain disabled.

## Unsigned deployment review and owner handoff, 22 October 2026

Prepared a reproducible 15-source verification bundle and exact zero-value EIP-1559 creation request with the confirmed addresses. The pinned reviewed creation hash and self-contained recompilation match the existing artifact. Public RPC simulation and CHOG/Safe/nonce/gas checks passed. The nonce-2 address is a prediction, not a deployed arena. See ops/DEPLOYMENT.md and security/deployment-draft-preparation.json.

An isolated Anvil fork with local chain ID 143 executed this exact request using fake MON and impersonation, behind the read-only gateway. The post-deployment verifier checked the resulting receipt, runtime/immutables, owner/revealer, fee, minimum, duration and initial counters. The local chain ID intentionally matches to test the request; this is not a real deployment. Evidence is security/deployment-draft-fork.json.

The owner gets a separate static loopback-only review page. It validates Host/Origin, serves an explicit allowlist, has no POST/deployment API and never reads credentials. Its browser code rechecks account/network/CHOG/Safe/nonce/gas before the owner's explicit wallet action; changed wallet state invalidates the review and a wallet request is never automatically retried. Contract creation/signing remains a human action in Rabby. Neither normal server nor keeper release guards were changed, no mainnet transaction was sent, and no demo or production credential state was touched.
