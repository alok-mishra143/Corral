use std::time::{SystemTime, UNIX_EPOCH};

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    if getrandom::fill(&mut buf).is_ok() {
        return buf;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    for (i, b) in buf.iter_mut().enumerate() {
        *b = ((nanos >> ((i % 16) * 8)) & 0xff) as u8;
    }
    buf
}

pub fn random_hex(n: usize) -> String {
    let bytes = random_bytes(n);
    let mut s = String::with_capacity(n * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}
