(function (root) {
    const formatter = {
        fromFile: function (source) { return { body: source }; },
        toFile: function (data) {
            if (typeof data.body !== 'string') throw new Error('HTML сторінки має бути текстом.');
            return data.body;
        },
    };
    if (typeof module === 'object' && module.exports) module.exports = formatter;
    else root.TCGRawFormat = formatter;
})(typeof window === 'undefined' ? globalThis : window);
