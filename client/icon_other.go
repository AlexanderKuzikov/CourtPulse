//go:build !windows

package main

import "unsafe"

func setWindowIcon(_ unsafe.Pointer) {}
