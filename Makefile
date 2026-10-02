BINARY := dist/corral

.PHONY: build vet fmt test clean

build:
	go build -o $(BINARY) ./cmd/corral

vet:
	go vet ./...

fmt:
	gofmt -w .

test:
	go test ./...

clean:
	rm -rf dist
