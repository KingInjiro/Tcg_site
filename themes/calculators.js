(function () {
    'use strict';
    const initialized = new WeakSet();
    const numberFormat = new Intl.NumberFormat('ru-RU', { maximumSignificantDigits: 15 });
    const moneyFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function readNumber(input) {
        const value = input.value.trim().replace(/\s/g, '').replace(',', '.');
        return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
    }

    function currencyCalculator() {
        const form = document.getElementById('currency-converter');
        if (!form || initialized.has(form)) return;
        initialized.add(form);
        const amount = form.elements.amount;
        const from = form.elements.from;
        const to = form.elements.to;
        const result = document.getElementById('currency-result');
        const fields = form.querySelector('fieldset');
        const rateView = document.getElementById('currency-rates');
        const dateView = document.getElementById('currency-date');
        const refresh = document.getElementById('currency-refresh');
        let rates = null;

        function calculate() {
            if (!rates) return;
            const value = readNumber(amount);
            const converted = value * rates[from.value] / rates[to.value];
            if (!Number.isFinite(value) || value < 0 || !Number.isFinite(converted)) {
                amount.setAttribute('aria-invalid', 'true');
                result.textContent = 'Введите сумму от 0. Можно использовать точку или запятую.';
                return;
            }
            amount.removeAttribute('aria-invalid');
            result.textContent = moneyFormat.format(value) + ' ' + from.value + ' = ' +
                moneyFormat.format(converted) + ' ' + to.value;
        }

        async function loadRates() {
            rates = null;
            fields.disabled = true;
            refresh.disabled = true;
            rateView.textContent = 'Загрузка...';
            dateView.textContent = '';
            result.textContent = 'Ожидание курсов НБУ.';
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                // Request today's date in Kyiv explicitly and validate the date returned by NBU.
                const parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
                }).formatToParts(new Date());
                const part = name => parts.find(value => value.type === name).value;
                const date = part('year') + part('month') + part('day');
                const displayedDate = part('day') + '.' + part('month') + '.' + part('year');
                const response = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=' + date + '&json', {
                    signal: controller.signal, cache: 'no-store',
                });
                if (!response.ok) throw new Error('Rate request failed');
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error('Invalid rate response');
                const usd = data.find(item => item.cc === 'USD');
                const eur = data.find(item => item.cc === 'EUR');
                for (const item of [usd, eur]) {
                    if (!item || typeof item.rate !== 'number' || !Number.isFinite(item.rate) || item.rate <= 0 ||
                        item.exchangedate !== displayedDate) throw new Error('Missing current rate');
                }
                rates = { UAH: 1, USD: usd.rate, EUR: eur.rate };
                rateView.replaceChildren();
                for (const [code, item, color] of [['USD', usd, 'green'], ['EUR', eur, 'blue']]) {
                    const label = document.createElement('span');
                    label.style.color = color;
                    label.textContent = code + ': ';
                    rateView.append(label, document.createTextNode(moneyFormat.format(item.rate) + ' грн'), document.createElement('br'));
                }
                dateView.textContent = 'Курс на ' + usd.exchangedate;
                fields.disabled = false;
                calculate();
            } catch {
                rates = null;
                rateView.textContent = 'Курсы НБУ недоступны.';
                result.textContent = 'Расчёт недоступен. Попробуйте обновить курс.';
            } finally {
                clearTimeout(timeout);
                refresh.disabled = false;
            }
        }

        form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
        form.addEventListener('input', calculate);
        form.addEventListener('change', calculate);
        refresh.addEventListener('click', loadRates);
        loadRates();
    }

    function backupCalculator() {
        const form = document.getElementById('backup-calculator');
        if (!form || initialized.has(form)) return;
        initialized.add(form);
        const size = form.elements.size;
        const copies = form.elements.copies;
        const reserve = form.elements.reserve;
        const result = document.getElementById('backup-result');
        const formula = document.getElementById('backup-formula');
        function calculate() {
            const volume = readNumber(size), count = readNumber(copies), extra = readNumber(reserve);
            const total = volume * count * (1 + extra / 100);
            const checks = [
                [size, Number.isFinite(volume) && volume > 0],
                [copies, Number.isSafeInteger(count) && count >= 1],
                [reserve, Number.isFinite(extra) && extra >= 0],
            ];
            for (const [field, valid] of checks) {
                if (valid) field.removeAttribute('aria-invalid');
                else field.setAttribute('aria-invalid', 'true');
            }
            if (checks.some(([, valid]) => !valid) || !Number.isFinite(total)) {
                result.textContent = 'Укажите объём больше 0, целое число копий от 1 и запас от 0%.';
                formula.textContent = '';
                return;
            }
            result.textContent = 'Требуется примерно ' + numberFormat.format(total) + ' ГБ';
            formula.textContent = numberFormat.format(volume) + ' ГБ × ' + numberFormat.format(count) +
                ' × (1 + ' + numberFormat.format(extra) + ' / 100) = ' + numberFormat.format(total) + ' ГБ';
        }
        form.addEventListener('submit', event => { event.preventDefault(); calculate(); });
        form.addEventListener('input', calculate);
        calculate();
    }

    const start = () => { currencyCalculator(); backupCalculator(); };
    start();
    document.addEventListener('tcg:page-load', start);
})();
