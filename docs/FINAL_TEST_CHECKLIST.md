# چک‌لیست تست نهایی — ShowUp روی Arc mainnet

همهٔ مراحل با USDC واقعی انجام می‌شوند؛ با مبلغ کم (۰٫۵ تا ۱ USDC) و فقط وقتی خودت تصمیم گرفتی تراکنش بفرست.
برای هر مورد hash تراکنش و لینک explorer را یادداشت کن. عبور تست‌های خودکار (mock) جایگزین این مراحل نیست؛ هیچ‌کدام از مراحل زیر هنوز با تراکنش واقعی روی مین‌نت انجام نشده‌اند.

## ۰. پیش از دیپلوی

- [ ] patch `showup-mainnet-v6-bridge-swap-nav-v3.patch` روی `mainnet-v6` (commit `14d5850`، بدون patchهای قبلی) اعمال شد و CI همان commit (lint، tsc، tests، build برای هر دو شبکه) سبز است.
- [ ] متغیرهای Vercel پروژهٔ `showup-arc-mainnet` بدون تغییر: `NEXT_PUBLIC_SHOWUP_WALLET_MODE=browser`، `NEXT_PUBLIC_SHOWUP_NETWORK=mainnet`، `NEXT_PUBLIC_SHOWUP_CHAIN_ID=5042`، `NEXT_PUBLIC_SHOWUP_CONTRACT_ADDRESS=0x6108613878E4FA3531f3CB478D12AC49147d7366`، و `SHOWUP_WALLET_AUTH_SECRET`، `SHOWUP_RECOVERY_SECRET`، `BLOB_READ_WRITE_TOKEN` موجود.
- [ ] `NEXT_PUBLIC_ENABLE_FIAT_ONRAMP` و `NEXT_PUBLIC_FIAT_ONRAMP_URL` دیگر استفاده نمی‌شوند (اگر تنظیم شده‌اند می‌توانی حذفشان کنی).
- [ ] (پیشنهادی) `NEXT_PUBLIC_SHOWUP_BASE_RPC_URLS` و `NEXT_PUBLIC_SHOWUP_ETHEREUM_RPC_URLS` با RPC اختصاصیِ محدود به دامنه.
- [ ] (اختیاری) `CIRCLE_SWAP_API_KEY` (کلید **mainnet**) + `NEXT_PUBLIC_SHOWUP_SWAP_PROXY=true`.
- [ ] `SHOWUP_SKIP_CONTRACT_CHECK` در production تنظیم **نشده** و build بررسی زندهٔ قرارداد را پاس کرد.
- [ ] patch `showup-mainnet-v6-dependency-hardening.patch` روی v3 اعمال شد؛ `cd web; npm ci` از lockfile جدید بدون خطا؛ `npm audit --omit=dev` باید ۲۰ مورد low (همه از elliptic) و ۰ moderate/high نشان دهد (جزئیات: `docs/DEPENDENCY_AUDIT.md`).
- [ ] پس از دیپلوی: صفحهٔ Swap باز شود، با ۱ واحد «Get quote» بزن و ببین quote از Circle برمی‌گردد (اولین بارگذاری واقعی App Kit با وابستگی‌های جدید روی مین‌نت).

## ۱. سربرگ و مسیرها (دسکتاپ و موبایل)

- [ ] دسکتاپ: How it works، Explore، Bridge، Swap و دکمهٔ Add Funds و اتصال کیف پول در یک خط؛ Infrastructure در سربرگ نیست و در فوتر («About & infrastructure») هست.
- [ ] Bridge ← `/wallet-tools/bridge`، Swap ← `/wallet-tools/swap`، Add Funds ← `/wallet-tools/add-funds`؛ گزینهٔ فعال مشخص است.
- [ ] باز کردن مستقیم هر سه آدرس، refresh، و Back/Forward همان بخش را نگه می‌دارند. `/wallet-tools` به Add funds می‌رود.
- [ ] موبایل: دکمهٔ منو همهٔ گزینه‌ها را نشان می‌دهد، با انتخاب هر گزینه (حتی Add Funds وقتی روی همان صفحه‌ای) بسته می‌شود، اسکرول افقی ندارد.

## ۲. Add Funds

- [ ] بدون کیف پول: راهنمای کوتاه + «Connect wallet» (انتخابگر کیف پول سربرگ را باز می‌کند) + «Bridge USDC to Arc».
- [ ] با کیف پول: آدرس، شبکه Arc mainnet (chain 5042)، توکن USDC، کپی آدرس، QR، موجودی‌ها، هشدار «فقط USDC روی Arc mainnet».
- [ ] QR را با کیف پول موبایل اسکن کن؛ آدرس دقیقاً همان آدرس نمایش‌داده‌شده باشد.
- [ ] (اختیاری) ۰٫۵ USDC روی Arc از حساب دیگری به این آدرس بفرست و افزایش موجودی را ببین.

## ۳. Bridge (CCTP V2)

| # | مسیر | تنظیم | انتظار |
|---|---|---|---|
| B1 | Base → Arc | Standard، Circle delivers | review کامل؛ approve دقیق به `0x28b5…cf5d`؛ burn؛ attestation (~۱۵–۲۰ دقیقه)؛ mint توسط Circle با لینک Arc؛ Completed |
| B2 | Arc → Base | Standard، I receive it myself (با ETH روی Base) | burn روی Arc؛ «Receive on Base»؛ receipt موفق؛ Completed |
| B3 | Ethereum → Arc | Fast | مبلغ دریافتی = مبلغ − fee اجراشده |
| B4 | Arc → Ethereum | — | فقط Standard قابل انتخاب است |

- [ ] B1 ‏ [ ] B2 ‏ [ ] B3 ‏ [ ] B4
- [ ] کمبود موجودی / کمبود گس مقصد ← پیام و دکمهٔ تأیید غیرفعال.
- [ ] quote بعد از ۶۰ ثانیه منقضی می‌شود.
- [ ] refresh حین انتظار attestation ← ادامه بدون درخواست burn دوم.
- [ ] رد امضای burn ← «Nothing was burned».
- [ ] رد prompt دریافت در B2 ← «Receive failed — retry available» ← retry موفق، بدون burn دوم.
- [ ] بازیابی با hash burn در مرورگر دیگر ← Completed بدون تراکنش جدید.
- [ ] تغییر حساب بعد از review ← burn رد می‌شود؛ تغییر شبکه ← quote پاک می‌شود.

## ۴. Swap (Arc)

- [ ] USDC → EURC (۱ USDC): quote، حداقل دریافتی، slippage، شمارش ۳۰ ثانیه؛ در کیف پول امضای permit برای **دقیقاً ۱ USDC** و spender `0x7FB8…a845`؛ تراکنش swap با کارمزد EIP-1559؛ پیام موفقیت فقط بعد از receipt با مبلغ دریافتی.
- [ ] EURC → USDC (۱ EURC): approve **دقیقاً ۱ EURC** به همان adapter، سپس swap.
- [ ] تغییر حساب یا شبکه بین quote و تأیید ← quote پاک می‌شود و هشدار نمایش داده می‌شود؛ تأیید ممکن نیست تا حساب برگردد.
- [ ] تغییر حساب یا شبکه بعد از زدن «Swap» و پیش از امضای تراکنش در کیف پول ← هیچ تراکنشی به کیف پول نمی‌رسد و پیام توقف نمایش داده می‌شود.
- [ ] بلافاصله بعد از زدن «Swap» (پیش از باز شدن prompt کیف پول) حساب را در کیف پول عوض کن و برگردان ← quote پاک می‌شود و هیچ prompt امضا یا تراکنشی برای quote قبلی باز نمی‌شود. (این race در تست‌های خودکار با provider شبیه‌سازی‌شده پوشش داده شده؛ روی کیف پول واقعی هنوز آزمایش نشده است.)
- [ ] در prompt کیف پول، شبکهٔ تراکنش swap و approve، Arc (chain 5042) است.
- [ ] quote منقضی ← «Refresh quote». رد امضا ← «Nothing was swapped».
- [ ] reload بلافاصله بعد از ارسال ← در Recent swaps وضعیت دوباره بررسی می‌شود؛ اگر هنوز اثبات نشده «Not confirmed yet» با دکمهٔ «Check again».
- [ ] (اختیاری، با کلید API) یک swap؛ و باز کردن مستقیم `/api/swap/circle/quote` در پنجرهٔ خصوصی ← 401.

## ۵. جریان‌های رویداد (نباید تغییر کرده باشند)

- [ ] ساخت رویداد عمومی با سپرده ۰٫۵ USDC و رزرو از حساب دوم.
- [ ] لغو رزرو قبل از ددلاین و بازپرداخت.
- [ ] رویداد پولی ۱ USDC: پرداخت کامل؛ و جداگانه سپرده + پرداخت باقی‌مانده.
- [ ] QR check-in: امضای برگزارکننده، اسکن از حساب شرکت‌کننده، تأیید حضور و receipt.
- [ ] لغو رویداد توسط برگزارکننده و بازپرداخت شرکت‌کننده.
- [ ] رویداد خصوصی با دعوت‌نامهٔ امضاشده؛ لغو یک دعوت استفاده‌نشده.
- [ ] عملیات برگزارکننده (settle no-show / mark default) پس از ددلاین واقعی.
- [ ] تغییر حساب بعد از approve پرداخت ← تراکنش برای حساب اشتباه مسدود.

## ۶. پس از تست

- [ ] hashها و لینک‌ها در release record (`docs/DEPLOYMENT.md` §11) ثبت شد.
- [ ] در صورت مشکل: `NEXT_PUBLIC_SHOWUP_DISABLE_BRIDGE=true` یا `NEXT_PUBLIC_SHOWUP_DISABLE_SWAP=true` و redeploy.
