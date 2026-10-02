use crate::policy::{self, FirewallRule, RuleMatch, RuleScope};
use crate::timeutil;
use crate::{error, info, success};

fn flag_value(argv: &[String], names: &[&str]) -> Option<String> {
    for n in names {
        for i in 0..argv.len() {
            if argv[i] == *n && i + 1 < argv.len() {
                return Some(argv[i + 1].clone());
            }
            let prefix = format!("{}=", n);
            if let Some(v) = argv[i].strip_prefix(&prefix) {
                return Some(v.to_string());
            }
        }
    }
    None
}

pub fn run_rules(argv: &[String]) -> i32 {
    let (sub, rest): (&str, &[String]) = match argv.split_first() {
        Some((s, r)) => (s.as_str(), r),
        None => ("list", &[]),
    };
    match sub {
        "list" => list_rules(),
        "deny" => deny_rule(rest),
        "rm" => remove_rule(rest),
        _ => {
            error!("Usage: corral rules [list|deny (--file GLOB|--command STR|--http HOST)|rm ID]");
            1
        }
    }
}

fn list_rules() -> i32 {
    let rules = policy::load_rules(&policy::default_rules_path());
    if rules.is_empty() {
        info!("No rules. Example: corral rules deny --file '**/notes.md'");
        return 0;
    }
    for r in &rules {
        let mark = if r.enabled { "[on] " } else { "[off]" };
        println!("{}{}  {}", mark, r.id, policy::describe_rule(r));
    }
    0
}

fn deny_rule(rest: &[String]) -> i32 {
    let file = flag_value(rest, &["--file"]);
    let command = flag_value(rest, &["--command"]);
    let http = flag_value(rest, &["--http", "--url"]);

    let (kind, value) = if let Some(f) = file {
        ("file", f)
    } else if let Some(c) = command {
        ("command", c)
    } else if let Some(h) = http {
        ("http", h)
    } else {
        error!("Usage: corral rules deny (--file GLOB | --command SUBSTRING | --http HOST)");
        return 1;
    };
    if value.is_empty() {
        error!("Usage: corral rules deny (--file GLOB | --command SUBSTRING | --http HOST)");
        return 1;
    }

    let mut scope = RuleScope::default();
    if let Some(cwd) = flag_value(rest, &["--cwd"]) {
        scope.cwd_prefix = Some(cwd);
    }
    if let Some(session) = flag_value(rest, &["--session"]) {
        scope.session_id = Some(session);
    }

    let rule = FirewallRule {
        id: policy::new_rule_id(),
        name: None,
        enabled: true,
        action: "deny".to_string(),
        scope,
        match_: RuleMatch {
            kind: kind.to_string(),
            value,
        },
        created_at: Some(timeutil::now_iso()),
    };

    let mut rules = policy::load_rules(&policy::default_rules_path());
    let key = policy::rule_key(&rule);
    if let Some(existing) = rules.iter().find(|r| policy::rule_key(r) == key) {
        info!("Already denied: {}", policy::describe_rule(existing));
        return 0;
    }
    rules.push(rule.clone());
    if policy::save_rules(&rules, &policy::default_rules_path()).is_err() {
        error!("Could not save rule.");
        return 1;
    }
    success!("Denied: {}", policy::describe_rule(&rule));
    0
}

fn remove_rule(rest: &[String]) -> i32 {
    let Some(id) = rest.first() else {
        error!("Usage: corral rules rm ID");
        return 1;
    };
    let rules = policy::load_rules(&policy::default_rules_path());
    let next: Vec<FirewallRule> = rules.iter().filter(|r| r.id != *id).cloned().collect();
    if next.len() == rules.len() {
        error!("Rule not found: {}", id);
        return 1;
    }
    if policy::save_rules(&next, &policy::default_rules_path()).is_err() {
        error!("Could not save rules.");
        return 1;
    }
    success!("Removed {}", id);
    0
}
