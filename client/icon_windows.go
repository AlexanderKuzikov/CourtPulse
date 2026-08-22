//go:build windows

package main

import (
	"runtime"
	"syscall"
	"unsafe"
)

func setWindowIcon(hwnd unsafe.Pointer) {
	if runtime.GOOS != "windows" || hwnd == nil {
		return
	}
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	user32 := syscall.NewLazyDLL("user32.dll")
	getModuleHandleW := kernel32.NewProc("GetModuleHandleW")
	loadIconW := user32.NewProc("LoadIconW")
	sendMessageW := user32.NewProc("SendMessageW")
	hInst, _, _ := getModuleHandleW.Call(0)
	hIcon, _, _ := loadIconW.Call(hInst, 1) // rsrc ID 1
	if hIcon == 0 {
		hIcon, _, _ = loadIconW.Call(0, 32512)
	}
	if hIcon != 0 {
		hwndPtr := uintptr(hwnd)
		sendMessageW.Call(hwndPtr, 0x0080, 1, hIcon)
		sendMessageW.Call(hwndPtr, 0x0080, 0, hIcon)
	}
}
