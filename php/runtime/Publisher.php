<?php
declare(strict_types=1);
namespace TCG;
if (!defined('TCG_ENTRY')) { http_response_code(404); exit; }
require_once __DIR__ . '/Compiler.php';
final class Publisher {
    public function __construct(private readonly Store $store, private readonly array $config) {}
    private function publicPath(string $name): string {
        if ($name === '' || preg_match('~[\\\\\x00-\x1f:]~', $name) || str_starts_with($name, '/') || array_intersect(explode('/', $name), ['', '.', '..']) || preg_match('~^(?:admin|api|\.)(?:/|$)~i', $name) || !preg_match('/\.(html?|json|js|png|jpe?g|gif|webp)$/i', $name)) throw new Problem('Недозволена ціль публікації.', 403);
        $path = $this->store->publicRoot . '/' . $name; Files::noLinks($path); return $path;
    }
    private function publicWrite(string $name, string $data): void {
        $path = $this->publicPath($name); $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) throw new Problem('Не вдалося створити папку сторінки.', 503);
        Files::atomic($path, $data, 0644);
    }
    private function emptyParents(string $name): void {
        $directory = dirname($this->publicPath($name));
        while ($directory !== $this->store->publicRoot && is_dir($directory)) {
            Files::noLinks($directory);
            if (count(scandir($directory)) !== 2) break;
            if (!rmdir($directory)) throw new Problem('Не вдалося прибрати порожню адресу сторінки.', 503);
            $directory = dirname($directory);
        }
    }
    public function recover(): void {
        $journal = $this->store->root . '/publication.json'; if (!is_file($journal)) return;
        $data = Files::json(Files::read($journal)); $stage = $this->store->root . '/transaction';
        if (($data['phase'] ?? '') === 'committed') { $this->cleanStage(); unlink($journal); return; }
        // Release staged new bytes before allocating rollback temporaries.
        foreach (glob($stage . '/new/*') ?: [] as $file) { Files::noLinks($file); if (is_file($file)) unlink($file); }
        foreach (array_reverse($data['files']) as $name => $old) {
            $path = $this->publicPath($name);
            $actual = is_file($path) ? hash_file('sha256', $path) : null;
            if ($actual !== $old && $actual !== ($data['next'][$name] ?? null)) throw new Problem('Відновлення зупинено: файл змінено іншою програмою.', 409);
            if ($old === null) { if (is_file($path) && !unlink($path)) throw new Problem('Не вдалося відновити попередню публікацію.', 503); }
            else { $saved = Files::read($stage . '/old/' . $old); if (!hash_equals($old, hash('sha256', $saved))) throw new Problem('Резерв публікації пошкоджений.', 503); $this->publicWrite($name, $saved); }
        }
        foreach ($data['files'] as $name => $old) if ($old === null) $this->emptyParents($name);
        if (isset($data['oldManifest'])) Files::atomic($this->store->root . '/published.json', Files::encode($data['oldManifest']));
        if (isset($data['oldState'])) Files::atomic($this->store->root . '/published-state.json', Files::encode($data['oldState']));
        elseif (is_file($this->store->root . '/published-state.json')) unlink($this->store->root . '/published-state.json');
        unlink($journal); $this->cleanStage();
    }
    private function cleanStage(): void {
        $directory = $this->store->root . '/transaction'; if (!is_dir($directory)) return;
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($directory, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($iterator as $entry) { Files::noLinks($entry->getPathname()); if ($entry->isDir()) rmdir($entry->getPathname()); else unlink($entry->getPathname()); } rmdir($directory);
    }
    public function publish(array $state): array {
        $this->recover();
        // A failed staging pass has no journal and may leave only disposable bytes.
        $this->cleanStage();
        $build = (new Compiler($this->store, $this->config))->build($state); $files = $build['files'];
        $manifestPath = $this->store->root . '/published.json';
        $oldManifest = is_file($manifestPath) ? Files::json(Files::read($manifestPath)) : $this->config['managed'];
        $next = []; foreach ($files as $name => $bytes) $next[$name] = hash('sha256', $bytes);
        $changes = [];
        foreach (array_unique(array_merge(array_keys($oldManifest), array_keys($files))) as $name) {
            $path = $this->publicPath($name); $exists = is_file($path);
            $parent = dirname($path); while (!is_dir($parent) && $parent !== $this->store->publicRoot) $parent = dirname($parent);
            if (!is_writable($parent)) throw new Problem('Немає прав публікації: ' . $name, 503);
            if (file_exists($path) && !$exists) throw new Problem('Адресу зайнято папкою або стороннім файлом: ' . $name, 409);
            $actual = $exists ? hash_file('sha256', $path) : null;
            if (!isset($oldManifest[$name]) && $exists) throw new Problem('Публікація не перезаписує сторонній файл: ' . $name, 409);
            if (isset($oldManifest[$name]) && $actual !== $oldManifest[$name]) throw new Problem('Сторінку змінено поза редактором: ' . $name, 409);
            if ($actual !== ($next[$name] ?? null)) $changes[$name] = $actual;
        }
        if (!$changes) { Files::atomic($this->store->root . '/published-state.json', Files::encode($state)); return ['ok' => true, 'published' => true, 'head' => $state['head'], 'version' => $build['version'], 'url' => '/']; }
        if (is_file($this->store->root . '/published-state.json')) {
            $previous = Files::json(Files::read($this->store->root . '/published-state.json'));
            if ($previous['head'] !== $state['head']) (new Pages($this->store))->remember($previous, 'Попередня опублікована версія');
        }
        $required = 0; foreach ($changes as $name => $old) $required += strlen($files[$name] ?? '') + ($old === null ? 0 : filesize($this->publicPath($name)));
        $largest = max(array_map('strlen', $files));
        $this->store->space($required + $largest + 262144);
        $this->cleanStage(); $stage = $this->store->root . '/transaction'; Files::directory($stage . '/old'); Files::directory($stage . '/new');
        $journal = [];
        foreach ($changes as $name => $old) {
            if ($old !== null) { $data = Files::read($this->publicPath($name)); Files::atomic($stage . '/old/' . $old, $data); }
            $journal[$name] = $old;
            if (isset($files[$name])) Files::atomic($stage . '/new/' . $next[$name], $files[$name]);
        }
        // Marker follows all HTML/resources; worker is last. Never announce an
        // incomplete publication, and retain rollback data until manifest commit.
        $rank = static fn($name) => $name === 'sw.js' ? 3 : ($name === 'site-version.json' ? 2 : (preg_match('/\.html?$/i', $name) ? 1 : 0));
        uksort($journal, static fn($a, $b) => $rank($a) <=> $rank($b) ?: strcmp($a, $b));
        $record = ['phase' => 'applying', 'files' => $journal, 'next' => $next, 'oldManifest' => $oldManifest, 'oldState' => is_file($this->store->root . '/published-state.json') ? Files::json(Files::read($this->store->root . '/published-state.json')) : null];
        Files::atomic($this->store->root . '/publication.json', Files::encode($record));
        try {
            foreach ($journal as $name => $old) {
                if (isset($files[$name])) $this->publicWrite($name, Files::read($stage . '/new/' . $next[$name]));
                elseif (!unlink($this->publicPath($name))) throw new Problem('Не вдалося прибрати видалену сторінку.', 503);
                else $this->emptyParents($name);
            }
            foreach ($next as $name => $sha) if (!hash_equals($sha, hash_file('sha256', $this->publicPath($name)))) throw new Problem('Публікація не пройшла перевірку.', 503);
            Files::atomic($manifestPath, Files::encode($next));
            Files::atomic($this->store->root . '/published-state.json', Files::encode($state));
            $record['phase'] = 'committed'; Files::atomic($this->store->root . '/publication.json', Files::encode($record));
        } catch (\Throwable $e) { $this->recover(); throw $e; }
        try { $this->cleanStage(); unlink($this->store->root . '/publication.json'); }
        catch (\Throwable $e) { return ['ok' => true, 'published' => true, 'head' => $state['head'], 'version' => $build['version'], 'url' => '/', 'cleanupPending' => true]; }
        return ['ok' => true, 'published' => true, 'head' => $state['head'], 'version' => $build['version'], 'url' => '/'];
    }
}
