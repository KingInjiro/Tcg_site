<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Masterminds\\')) return;
    $relative = str_replace('\\', '/', substr($class, 12));
    if (!preg_match('~^[A-Za-z0-9_/]+$~D', $relative)) return;
    $file = __DIR__ . '/vendor/html5/src/' . $relative . '.php';
    if (is_file($file)) require_once $file;
});
final class HTML {
    private static function engine(): \Masterminds\HTML5 {
        // Match parse5's default scripting-enabled tree. Legacy counter blocks
        // must remain raw noscript text, including their original nesting.
        \Masterminds\HTML5\Elements::$html5['noscript'] = \Masterminds\HTML5\Elements::KNOWN_ELEMENT | \Masterminds\HTML5\Elements::TEXT_RAW;
        return new \Masterminds\HTML5(['disable_html_ns' => true]);
    }
    public static function parse(string $html): \DOMDocument {
        if (!class_exists(\DOMDocument::class)) throw new Problem('Публікація потребує PHP DOM.', 503);
        return self::engine()->loadHTML($html);
    }
    public static function serialize(\DOMNode $node): string { return self::engine()->saveHTML($node); }
    public static function xpath(\DOMNode $node, string $expression): array { $doc = $node instanceof \DOMDocument ? $node : $node->ownerDocument; return iterator_to_array((new \DOMXPath($doc))->query($expression, $node)); }
    public static function first(\DOMNode $node, string $expression): ?\DOMNode { return self::xpath($node, $expression)[0] ?? null; }
    public static function hasClass(\DOMElement $node, string $class): bool { return in_array($class, preg_split('/\s+/', $node->getAttribute('class')), true); }
    public static function fragment(\DOMDocument $doc, string $html): array { $fragment = self::engine()->loadHTMLFragment($html); return array_map(fn($node) => $doc->importNode($node, true), iterator_to_array($fragment->childNodes)); }
    public static function remove(?\DOMNode $node): void { if ($node?->parentNode) $node->parentNode->removeChild($node); }
    public static function document(\DOMDocument $doc): string { return "<!DOCTYPE html>\n" . self::serialize($doc->documentElement); }
}
