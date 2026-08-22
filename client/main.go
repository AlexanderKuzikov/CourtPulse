package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/webview/webview_go"
)

func main() {
	defaultURL := "https://courtpulse.135.106.192.125.nip.io"
	urlFlag := flag.String("url", "", "CourtPulse server URL (e.g. https://courtpulse.135.106.192.125.nip.io or http://localhost:8781)")
	flag.Parse()

	targetURL := *urlFlag
	if targetURL == "" {
		targetURL = defaultURL
	}

	targetURL = strings.TrimSuffix(targetURL, "/")
	if strings.HasSuffix(targetURL, "/api") {
		targetURL = strings.TrimSuffix(targetURL, "/api")
	}

	w := webview.New(true)
	if w == nil {
		fmt.Println("Error: failed to create window")
		os.Exit(1)
	}
	defer w.Destroy()

	// Установка иконки на Win32 HWND через SendMessageW WM_SETICON
	setWindowIcon(w.Window())

	w.SetTitle("CourtPulse — Мониторинг судов (Пермский край)")
	w.SetSize(1280, 800, webview.HintNone)

	w.Navigate(targetURL)

	w.Run()
}
