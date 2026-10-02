package logger

import (
	"fmt"
	"os"
)

const tag = "corral"

func Success(a ...any) { fmt.Println(append([]any{"[" + tag + "]"}, a...)...) }
func Info(a ...any)    { fmt.Println(append([]any{"[" + tag + "]"}, a...)...) }
func Warn(a ...any)    { fmt.Fprintln(os.Stderr, append([]any{"[" + tag + "]"}, a...)...) }
func Error(a ...any)   { fmt.Fprintln(os.Stderr, append([]any{"[" + tag + "]"}, a...)...) }
