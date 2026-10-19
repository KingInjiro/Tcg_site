<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/HTML.php'; require_once __DIR__ . '/Routes.php'; require_once __DIR__ . '/Header.php';
final class Pages {
    public function __construct(private readonly Store $store) {}
    public function versions(): array {
        $result = [];
        foreach (glob($this->store->root . '/versions/*.json') ?: [] as $file) { $state = Files::json(Files::read($file)); $result[] = ['id' => basename($file, '.json'), 'label' => $state['label'], 'time' => $state['time']]; }
        usort($result, fn($a, $b) => strcmp($b['id'], $a['id'])); return $result;
    }
    public function remember(array $state, string $label): void {
        $id = sprintf('%020.0f', microtime(true) * 1000000) . '-' . bin2hex(random_bytes(6));
        $this->store->space(strlen(Files::encode($state)) + 65536);
        Files::atomic($this->store->root . '/versions/' . $id . '.json', Files::encode($state + ['label' => $label, 'time' => gmdate('c')]));
        $versions = $this->versions(); foreach (array_slice($versions, 3) as $version) unlink($this->store->root . '/versions/' . $version['id'] . '.json');
    }
    public function restore(array $state, string $id): array {
        if (!preg_match('/^[0-9]{14,20}-[a-f0-9]{12}$/D', $id)) throw new Problem('Некоректна резервна версія.');
        $path = $this->store->root . '/versions/' . $id . '.json'; if (!is_file($path)) throw new Problem('Версію не знайдено.', 404);
        $previous = Files::json(Files::read($path));
        foreach ($previous['files'] as $name => $sha) { if (!(Files::page($name) || Files::project($name) || Images::editable($name))) throw new Problem('Пошкоджена версія.', 503); $this->store->object($sha); }
        $this->remember($state, 'Перед відновленням');
        unset($previous['label'], $previous['time'], $previous['head']); return $this->store->commit($previous);
    }
    public function change(array $state, string $path, ?string $newPath): array {
        if (!Files::page($path) || !isset($state['files'][$path]) || strtolower(preg_replace('/\.html?$/i', '', $path)) === 'index') throw new Problem('Цю сторінку не можна видалити або перейменувати.');
        $pages = array_values(array_filter(array_keys($state['files']), [Files::class, 'page']));
        $this->store->space(array_sum(array_map(fn($file) => strlen($this->store->object($state['files'][$file])), $pages)) + 65536);
        if ($newPath !== null) {
            if (!Files::page($newPath)) throw new Problem('Некоректна нова адреса.');
            foreach ($pages as $existing) if ($existing !== $path && strtolower(Routes::url($existing)) === strtolower(Routes::url($newPath))) throw new Problem('Адресу вже зайнято.', 409);
            foreach ($state['aliases'] as $old => $target) if ($target !== $path && strtolower(Routes::url($old)) === strtolower(Routes::url($newPath))) throw new Problem('Адреса збережена як попереднє посилання іншої сторінки.', 409);
            if ($newPath === $path) return $state;
        }
        $this->remember($state, $newPath === null ? 'Перед видаленням ' . $path : 'Перед перейменуванням ' . $path);
        foreach ($pages as $file) {
            if ($file === $path && $newPath === null) continue;
            $html = $this->store->object($state['files'][$file]);
            $next = Routes::rewrite($html, $file, $pages, $newPath === null ? [] : [$path => $newPath], $newPath === null ? [$path] : [], $file === $path);
            if ($html !== $next || $file === $path) { $target = $file === $path ? $newPath : $file; $state['files'][$target] = $this->store->put($next); unset($state['files']['.tcg-editor/' . $target . '.json']); }
        }
        unset($state['files'][$path], $state['files']['.tcg-editor/' . $path . '.json']);
        foreach ($state['aliases'] as $old => $target) { if ($target === $path) { if ($newPath === null) unset($state['aliases'][$old]); else $state['aliases'][$old] = $newPath; } }
        if ($newPath !== null) { unset($state['aliases'][$newPath]); $state['aliases'][$path] = $newPath; }
        return $this->store->commit($state);
    }
    public function menu(array $state, ?array $items = null): array {
        $home = $this->store->object($state['files']['index.html']); $doc = HTML::parse(Header::apply($home, Header::get($home)));
        $nav = HTML::first($doc, './/header//nav[contains(concat(" ",normalize-space(@class)," ")," legacy-top-navigation ")]');
        if (!$nav) throw new Problem('Спільне меню не знайдене.');
        $anchors = HTML::xpath($nav, './a'); $map = Routes::map(array_values(array_filter(array_keys($state['files']), [Files::class, 'page']))); $current = [];
        foreach ($anchors as $index => $a) { [$url] = Routes::split(Routes::absolute($a->getAttribute('href'), 'index.html')); $image = HTML::first($a, './/img'); $current[] = ['original' => $index, 'page' => $map[strtolower(rawurldecode($url))] ?? null, 'label' => $image?->getAttribute('alt') ?: trim($a->textContent)]; }
        if ($items === null) return $current;
        $this->store->space(strlen($home) * 2 + 65536);
        if (count($items) > 30) throw new Problem('У меню може бути не більше 30 пунктів.');
        $used = []; $children = [];
        foreach ($items as $item) {
            $page = $item['page'] ?? ''; $label = $item['label'] ?? ''; $original = $item['original'] ?? null;
            if (!is_string($page) || !Files::page($page) || !isset($state['files'][$page]) || !is_string($label) || trim($label) === '' || strlen($label) > 160) throw new Problem('Вкажіть назву й наявну сторінку для кожного пункту.');
            if ($original !== null && (!is_int($original) || !isset($anchors[$original]) || isset($used[$original]))) throw new Problem('Повторний або некоректний пункт меню.');
            if ($original !== null) { $used[$original] = true; $a = $anchors[$original]->cloneNode(true); }
            else $a = $doc->createElement('a');
            $a->setAttribute('href', Routes::url($page));
            if ($original === null || $current[$original]['label'] !== $label) { while ($a->firstChild) $a->removeChild($a->firstChild); $a->appendChild($doc->createTextNode($label)); $a->setAttribute('class', 'top-nav-text'); }
            $children[] = $a;
        }
        $this->remember($state, 'Перед зміною меню'); while ($nav->firstChild) $nav->removeChild($nav->firstChild);
        foreach ($children as $a) { $nav->appendChild($a); $nav->appendChild($doc->createTextNode(' ')); }
        $html = HTML::document($doc);
        $state['files']['index.html'] = $this->store->put(Header::apply($html, Header::get($html))); unset($state['files']['.tcg-editor/index.html.json']);
        return $this->store->commit($state);
    }
}
