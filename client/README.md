# CourtPulse Desktop Client (Go + WebView)

Нативное клиентское приложение для просмотра дашборда CourtPulse. Работает на базе системного WebView2 (Windows) / WebKitGTK (Linux) без тяжелого Electron-оверхеда (размер бинарника ~6-8 МБ).

## Сборка

### Windows (без консольного окна)
```bash
go build -ldflags="-s -w -H windowsgui" -o CourtPulseClient.exe .
```

### Генерация иконки `.ico` и привязка через `rsrc` (опционально для Windows):
```bash
python make_icon.py
go install github.com/akavel/rsrc@latest
rsrc -ico icon.ico -o rsrc_windows_amd64.syso
go build -ldflags="-s -w -H windowsgui" -o CourtPulseClient.exe .
```

### Запуск
```bash
./CourtPulseClient.exe -url=https://135.106.192.125.nip.io
```
По умолчанию подключается к основному серверу на VPS `https://135.106.192.125.nip.io`.
