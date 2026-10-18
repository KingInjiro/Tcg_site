<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
final class Header {
    private static function shared(\DOMNode $doc): ?\DOMNode { return HTML::first($doc, './/header[contains(concat(" ",normalize-space(@class)," ")," site-header ")]'); }
    private static function logo(\DOMNode $doc): ?\DOMNode { return HTML::first($doc, './/table[@id="table2"]'); }
    private static function navigation(?\DOMNode $logo): ?\DOMNode {
        $next = $logo?->nextSibling; while ($next && !$next instanceof \DOMElement) $next = $next->nextSibling;
        return $next instanceof \DOMElement && in_array($next->tagName, ['p', 'nav'], true) && preg_match('/_GBTN\.GIF|top-nav-icon/i', HTML::serialize($next)) ? $next : null;
    }
    public static function removeUp(\DOMNode $doc): void {
        foreach (HTML::xpath($doc, './/img') as $image) if (preg_match('~(?:^|/)UP_CMP_-1-010_GBTN\.GIF(?:[?#].*)?$~i', $image->getAttribute('src'))) {
            $button = $image->parentNode instanceof \DOMElement && $image->parentNode->tagName === 'a' ? $image->parentNode : $image; $row = $button->parentNode;
            HTML::remove($button);
            if ($row instanceof \DOMElement && in_array($row->tagName, ['p', 'nav'], true) && !HTML::first($row, './*') && trim($row->textContent) === '') HTML::remove($row);
        }
    }
    public static function get(string $html): ?array {
        $doc = HTML::parse($html); self::removeUp($doc); $existing = self::shared($doc);
        $style = HTML::first($doc, './/style[@data-tcg-editor-css]'); $previous = HTML::first($doc, './/style[@id="tcg-header-style"]');
        $css = $style ? "@scope (:has(> .site-header)) to (:scope > :not(.site-header)) {\n" . $style->textContent . "\n}" : ($previous?->textContent ?? '');
        if ($existing) return ['html' => HTML::serialize($existing), 'css' => $css];
        $logo = self::logo($doc); $navigation = self::navigation($logo); if (!$logo || !$navigation) return null;
        $links = ''; foreach ($navigation->childNodes as $node) $links .= $node instanceof \DOMText ? ' ' : HTML::serialize($node);
        return ['html' => '<header class="site-header">' . HTML::serialize($logo) . '<nav class="legacy-top-navigation" aria-label="Основная навигация">' . $links . '</nav></header>', 'css' => $css];
    }
    public static function apply(string $html, ?array $header): string {
        if (!$header) return $html;
        $doc = HTML::parse($html); $body = $doc->getElementsByTagName('body')->item(0); $head = $doc->getElementsByTagName('head')->item(0); self::removeUp($body);
        $existing = self::shared($body);
        if ($existing) HTML::remove($existing);
        else {
            $logo = self::logo($body); HTML::remove(self::navigation($logo));
            if ($logo) { $parent = $logo->parentNode; HTML::remove($logo);
                while ($parent && $parent !== $body && !HTML::first($parent, './*') && trim($parent->textContent) === '') { $next = $parent->parentNode; HTML::remove($parent); $parent = $next; }
            }
        }
        $first = null; foreach ($body->childNodes as $child) if ($child instanceof \DOMElement && !HTML::hasClass($child, 'skip-link')) { $first = $child; break; }
        foreach (HTML::fragment($doc, $header['html']) as $node) $body->insertBefore($node, $first);
        if (!HTML::hasClass($body, 'site-page')) $body->setAttribute('class', trim($body->getAttribute('class') . ' site-page'));
        foreach (array_merge(['/themes/html5.css', '/themes/banner.css', '/themes/layout.css', '/themes/navigation.css'], str_contains($header['html'], 'top-nav-text') ? ['/themes/cms-menu.css'] : []) as $href) {
            if (!HTML::first($head, './/link[@href="' . $href . '"]')) { $link = $doc->createElement('link'); $link->setAttribute('rel', 'stylesheet'); $link->setAttribute('href', $href); $head->appendChild($link); }
        }
        HTML::remove(HTML::first($head, './/style[@id="tcg-header-style"]'));
        if ($header['css'] !== '') { $style = $doc->createElement('style'); $style->setAttribute('id', 'tcg-header-style'); $style->appendChild($doc->createTextNode($header['css'])); $head->appendChild($style); }
        return HTML::document($doc);
    }
}
