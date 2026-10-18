<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/Pages.php';
final class Compiler {
    private const ICONS = '<link rel="icon" href="/favicon.ico"><link rel="icon" type="image/png" href="/images/favicon-32.png"><link rel="icon" type="image/gif" href="/images/tcg_log3.gif">';
    public function __construct(private readonly Store $store, private readonly array $config) {}
    public static function redirect(string $url): string {
        $attr = htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); $js = json_encode($url, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>TCG</title>' . self::ICONS . '<script>location.replace(' . $js . '+location.search+location.hash)</script><meta http-equiv="refresh" content="0;url=' . $attr . '"></head><body><a href="' . $attr . '">Перейти на сторінку</a></body></html>';
    }
    private function page(string $html, string $file, array $pages, ?array $header): string {
        $doc = HTML::parse(Header::apply($html, $header)); $routes = Routes::map($pages);
        foreach (HTML::xpath($doc, '//*') as $node) {
            foreach (['href', 'src', 'action', 'poster', 'background'] as $attr) if ($node->hasAttribute($attr)) {
                $url = Routes::absolute($node->getAttribute($attr), $file); [$pathname, $suffix] = Routes::split($url);
                $target = in_array($node->tagName, ['a', 'area', 'form'], true) ? ($routes[strtolower(rawurldecode($pathname))] ?? null) : null;
                $node->setAttribute($attr, ($target ? Routes::url($target) . $suffix : $url));
            }
            if ($node->hasAttribute('style')) $node->setAttribute('style', Routes::css($node->getAttribute('style'), $file));
            if ($node->hasAttribute('srcset') && stripos($node->getAttribute('srcset'), 'data:') === false) $node->setAttribute('srcset', preg_replace_callback('/(^|,\s*)([^\s,]+)(?=\s|$)/', fn($m) => $m[1] . Routes::absolute($m[2], $file), $node->getAttribute('srcset')));
            if ($node->tagName === 'style') $node->textContent = Routes::css($node->textContent, $file);
            if (in_array($node->tagName, ['a', 'area'], true)) {
                $node->removeAttribute('data-tcg-page'); $href = $node->getAttribute('href');
                $pathname = str_starts_with($href, '#') ? '/' . $file : (parse_url(Routes::absolute($href, $file), PHP_URL_PATH) ?: '/' . $file);
                if ($href !== '' && isset($routes[strtolower(rawurldecode($pathname))])) $node->setAttribute('data-tcg-page', '');
            }
        }
        $head = $doc->getElementsByTagName('head')->item(0); if (!$head) throw new Problem('У сторінки немає head: ' . $file);
        foreach (iterator_to_array($head->childNodes) as $node) {
            if (!$node instanceof \DOMElement) continue;
            if ($node->tagName === 'link' && array_intersect(['canonical', 'manifest', 'icon'], preg_split('/\s+/', strtolower($node->getAttribute('rel'))))) HTML::remove($node);
            if ($node->tagName === 'meta' && in_array($node->getAttribute('name'), ['tcg-page', 'theme-color', 'tcg-build'], true)) HTML::remove($node);
            if ($node->tagName === 'script' && in_array(strtok($node->getAttribute('src'), '?'), ['/themes/clean-urls.js', '/themes/service-worker.js', '/themes/navigation.js'], true)) HTML::remove($node);
        }
        $fragment = '<link rel="canonical" data-tcg-canonical href="' . Routes::url($file) . '"><meta name="tcg-page" content="1"><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000000">' . self::ICONS . '<script src="/themes/clean-urls.js" defer></script><script src="/themes/service-worker.js" defer></script><script src="/themes/navigation.js" defer></script>';
        foreach (HTML::fragment($doc, $fragment) as $node) $head->appendChild($node);
        return HTML::document($doc);
    }
    private static function text(\DOMNode $node): string {
        if ($node instanceof \DOMText) return $node->data;
        if ($node instanceof \DOMElement && (in_array($node->tagName, ['script', 'style', 'noscript', 'form', 'nav'], true) || str_contains($node->getAttribute('class'), 'legacy-top-navigation'))) return '';
        $text = ''; foreach ($node->childNodes as $child) $text .= self::text($child);
        return $text . ($node instanceof \DOMElement && in_array($node->tagName, ['p', 'div', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'], true) ? ' ' : '');
    }
    public function build(array $state): array {
        $sources = []; $outputs = []; $static = []; $index = []; $aliases = []; $pageURLs = [];
        foreach ($state['files'] as $file => $sha) if (Files::page($file)) $sources[$file] = $this->store->object($sha);
        if (!isset($sources['index.html'])) throw new Problem('Головна сторінка відсутня.');
        $pages = array_keys($sources); $header = Header::get($sources['index.html']);
        foreach ($this->config['staticFiles'] as $file => $sha) {
            $data = Files::read($this->store->publicRoot . '/' . $file);
            if (!hash_equals($sha, hash('sha256', $data))) throw new Problem('Ресурс змінено поза редактором: ' . $file, 409);
            $static[$file] = $data;
        }
        foreach ($sources as $file => $html) {
            $output = Routes::output($file); if (isset($static[$output])) throw new Problem('Адреса зайнята ресурсом: ' . $output, 409);
            $outputs[$output] = $this->page($html, $file, $pages, $header); $pageURLs[Routes::url($file)] = $output;
            foreach ([$file, preg_replace('/\.html?$/i', '.htm', $file), strtoupper(preg_replace('/\.html?$/i', '.htm', $file)), preg_replace('/\.html?$/i', '.htm', $output)] as $alias) if ($alias !== $output) { if (isset($static[$alias])) throw new Problem('Зайнята стара адреса: ' . $alias, 409); $outputs[$alias] = self::redirect(Routes::url($file)); }
            if (!in_array($file, ['search.html', 'header.html', 'toc.html'], true)) {
                $doc = HTML::parse($html); $content = HTML::first($doc, './/*[contains(concat(" ",normalize-space(@class)," ")," site-content ") or contains(concat(" ",normalize-space(@class)," ")," WordSection1 ")]') ?? $doc->getElementsByTagName('body')->item(0) ?? $doc;
                $title = $doc->getElementsByTagName('title')->item(0);
                $normalize = static fn($value) => trim(preg_replace('/\s+/u', ' ', $value));
                $index[] = ['url' => Routes::url($file), 'title' => $normalize($title ? self::text($title) : ''), 'text' => $normalize(self::text($content))];
            }
        }
        foreach (Routes::map($pages) as $alias => $file) $aliases[$alias] = Routes::url($file);
        foreach ($state['aliases'] as $old => $target) if (isset($sources[$target])) {
            foreach (Routes::map([$old]) as $alias => $_) $aliases[$alias] = Routes::url($target);
            foreach ([$old, preg_replace('/\.html?$/i', '.htm', $old), Routes::output($old), preg_replace('/\.html?$/i', '.htm', Routes::output($old)), strtoupper(preg_replace('/\.html?$/i', '.htm', $old))] as $alias) {
                if (isset($static[$alias]) || isset($outputs[$alias])) throw new Problem('Конфлікт попередньої адреси: ' . $alias, 409);
                $outputs[$alias] = self::redirect(Routes::url($target));
            }
        }
        foreach ($state['files'] as $file => $sha) if (Images::editable($file)) $outputs[$file] = $this->store->object($sha);
        $outputs['themes/search-index.json'] = Files::encode($index);
        $outputs['themes/contact-config.json'] = Files::encode(['endpoint' => '/admin/contact.php']);
        $entries = []; foreach ($pageURLs as $url => $file) $entries[$url] = $outputs[$file];
        foreach (array_merge($static, $outputs) as $file => $data) if (preg_match('~^(?:images|derived|themes|[\w.-]+\.files)/~', $file) && preg_match('/\.(css|js|png|jpe?g|gif|webp|svg|woff2?)$/i', $file)) $entries['/' . $file] = $data;
        foreach (['manifest.json', 'favicon.ico', 'themes/offline.html', 'themes/search-index.json'] as $file) if (isset($outputs[$file]) || isset($static[$file])) $entries['/' . $file] = $outputs[$file] ?? $static[$file];
        ksort($entries); $hash = hash_init('sha256'); hash_update($hash, $this->config['compiler']);
        $sw = Files::read(__DIR__ . '/worker.txt'); hash_update($hash, $sw);
        foreach ($entries as $url => $data) { hash_update($hash, $url); hash_update($hash, $data); }
        $version = substr(hash_final($hash), 0, 20);
        foreach ($pageURLs as $file) {
            $html = preg_replace('~</head>~i', '<meta name="tcg-build" content="' . $version . '"></head>', $outputs[$file], 1);
            $outputs[$file] = preg_replace_callback('~<(?:link|script)\b[^>]*>~i', fn($tag) => preg_replace_callback('~\b(href|src)="(/[^"?]+\.(?:css|js))"~i', fn($m) => isset($entries[rawurldecode($m[2])]) ? $m[1] . '="' . $m[2] . '?v=' . $version . '"' : $m[0], $tag[0]), $html);
        }
        $urls = array_map(static fn($url) => implode('/', array_map('rawurlencode', explode('/', rawurldecode($url)))), array_keys($entries));
        $worker = ['version' => $version, 'urls' => $urls, 'aliases' => $aliases];
        $outputs['sw.js'] = str_replace('/* TCG_BUILD_CONFIG */', 'self.TCG_PWA = ' . Files::encode($worker) . ';', $sw);
        $outputs['site-version.json'] = Files::encode(['version' => $version]) . "\n";
        return ['files' => $outputs, 'version' => $version];
    }
}
