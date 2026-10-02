package main

import (
	"fmt"
	"os"

	"corral/internal/cli"
)

const Version = "0.2.0"

func help() {
	fmt.Println("corral — restrict OpenCode agent file access via firewall rules")
	fmt.Println("")
	fmt.Println("Usage: corral <command>")
	fmt.Println("")
	fmt.Println("Commands:")
	fmt.Println("  d, admin [--port N] [--no-open]   Open the dashboard")
	fmt.Println("  daemon [--port N]                 Start the local firewall server")
	fmt.Println("  restart [--port N]                Restart the daemon (kills old, starts new)")
	fmt.Println("  uninstall [--yes] [--keep-data] [--port N]")
	fmt.Println("                                    Remove corral from this computer")
	fmt.Println("  setup                             Install the OpenCode plugin")
	fmt.Println("  rules list                        List firewall rules")
	fmt.Println("  rules deny --file GLOB            Deny agent access to a file glob")
	fmt.Println("  rules rm ID                       Remove a rule by id")
	fmt.Println("  doctor [--port N]                 Diagnose setup")
	fmt.Println("  version                           Print version")
	fmt.Println("  help                              Show this help")
}

func main() {
	args := os.Args[1:]
	cmd := ""
	var rest []string
	if len(args) > 0 {
		cmd = args[0]
		rest = args[1:]
	}

	code := 0
	switch cmd {
	case "daemon":
		code = cli.RunDaemon(rest)
	case "restart":
		code = cli.RunRestart(rest)
	case "uninstall":
		code = cli.RunUninstall(rest)
	case "setup":
		code = cli.RunSetup()
	case "rules":
		code = cli.RunRules(rest)
	case "d", "dashboard", "admin":
		code = cli.RunAdmin(rest)
	case "doctor":
		code = cli.RunDoctor(rest)
	case "help", "--help", "-h":
		help()
	case "version":
		fmt.Printf("corral v%s\n", Version)
	default:
		help()
		if cmd == "" {
			code = 1
		}
	}
	os.Exit(code)
}
