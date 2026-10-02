BINARY := target/release/corral

.PHONY: build check fmt test clean

build:
	cargo build --release

check:
	cargo check

fmt:
	cargo fmt

test:
	cargo test

clean:
	cargo clean
