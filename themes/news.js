(() => {
    'use strict';

    function updateNews() {
        fetch('https://api.rss2json.com/v1/api.json?rss_url=https://news.finance.ua/rss')
            .then(response => response.json())
            .then(data => {
                if (data.status === 'ok' && data.items) {
                    const list = document.getElementById('news-list');
                    list.innerHTML = '';

                    const newsToShow = data.items.slice(0, 10);
                    newsToShow.forEach(item => {
                        const li = document.createElement('li');
                        li.style.marginBottom = '8px';
                        li.innerHTML = '<a href="' + item.link + '" target="_blank" style="color: #336699; text-decoration: none;">' + item.title + '</a>';
                        list.appendChild(li);
                    });
                } else {
                    document.getElementById('news-list').innerHTML = '<li>Не удалось загрузить новости</li>';
                }
            })
            .catch(() => {
                document.getElementById('news-list').innerHTML = '<li>Ошибка сети</li>';
            });
    }

    updateNews();
})();
