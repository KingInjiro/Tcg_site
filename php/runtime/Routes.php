<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
final class Routes {
    public static function url(string $file): string { $stem = preg_replace('/\.html?$/i', '', $file); return strtolower($stem) === 'index' ? '/' : '/' . implode('/', array_map('rawurlencode', explode('/', $stem))) . '/'; }
    public static function output(string $file): string { return rawurldecode(substr(self::url($file), 1)) . 'index.html'; }
    public static function map(array $pages): array {
        $map = [];
        foreach ($pages as $file) { $url = self::url($file); foreach (['/' . $file, '/' . preg_replace('/\.html?$/i', '.htm', $file), $url, $url === '/' ? '/' : rtrim($url, '/'), '/' . self::output($file)] as $alias) $map[strtolower($alias)] = $file; }
        return $map;
    }
    public static function absolute(string $value, string $file): string {
        if ($value === '' || $value[0] === '#' || str_starts_with($value, '//') || preg_match('/^[a-z][a-z\d+.-]*:/i', $value)) return $value;
        $parts = preg_split('/(?=[?#])/', $value, 2); $path = str_replace('\\', '/', $parts[0]); $suffix = $parts[1] ?? '';
        if ($path === '') $path = '/' . $file;
        elseif ($path[0] !== '/') $path = (dirname($file) === '.' ? '/' : '/' . dirname($file) . '/') . $path;
        $segments = [];
        foreach (explode('/', $path) as $segment) { $decoded = rawurldecode($segment); if ($decoded === '' || $decoded === '.') continue; if ($decoded === '..') array_pop($segments); else $segments[] = str_replace(['%21', '%24', '%26', '%27', '%28', '%29', '%2A', '%2B', '%2C', '%3A', '%3B', '%3D', '%40'], ['!', '$', '&', "'", '(', ')', '*', '+', ',', ':', ';', '=', '@'], rawurlencode($decoded)); }
        return '/' . implode('/', $segments) . (str_ends_with($path, '/') && $segments ? '/' : '') . $suffix;
    }
    public static function split(string $value): array { $parts = preg_split('/(?=[?#])/', $value, 2); return [$parts[0], $parts[1] ?? '']; }
    public static function css(string $text, string $file): string { return preg_replace_callback('/url\(\s*([\'"]?)([^)\'"]+)\1\s*\)/i', fn($m) => 'url("' . str_replace('"', '%22', self::absolute(trim($m[2]), $file)) . '")', $text); }
    public static function rewrite(string $html, string $file, array $pages, array $moves = [], array $removed = [], bool $resources = false): string {
        $map = self::map($pages); $doc = HTML::parse($html); $changed = false;
        foreach (HTML::xpath($doc, '//*') as $node) {
            if (!$node instanceof \DOMElement) continue;
            foreach (['href', 'src', 'action', 'poster', 'background'] as $name) {
                if (!$node->hasAttribute($name)) continue;
                $original = $node->getAttribute($name); $absolute = self::absolute($original, $file); [$pathname, $suffix] = self::split($absolute); $target = $map[strtolower(rawurldecode($pathname))] ?? null;
                if ($target && in_array($target, $removed, true) && in_array($node->tagName, ['a', 'area'], true) && $name === 'href') {
                    $menu = HTML::first($node, 'ancestor::nav | ancestor::header') || preg_match('/_[GHV]BTN\.GIF/i', HTML::serialize($node));
                    if (!$menu && $node->parentNode) while ($node->firstChild) $node->parentNode->insertBefore($node->firstChild, $node);
                    HTML::remove($node); $changed = true; break;
                }
                $next = isset($moves[$target ?? '']) ? self::url($moves[$target]) . $suffix : ($resources ? $absolute : $original);
                if ($next !== $original) { $node->setAttribute($name, $next); $changed = true; }
            }
            if ($resources && $node->hasAttribute('style')) { $old = $node->getAttribute('style'); $next = self::css($old, $file); if ($old !== $next) { $node->setAttribute('style', $next); $changed = true; } }
            if ($resources && $node->tagName === 'style') { $old = $node->textContent; $next = self::css($old, $file); if ($old !== $next) { $node->textContent = $next; $changed = true; } }
        }
        return $changed ? HTML::document($doc) : $html;
    }
}
