const TAG: &str = "corral";

pub fn success(args: std::fmt::Arguments<'_>) {
    println!("[{}] {}", TAG, args);
}
pub fn info(args: std::fmt::Arguments<'_>) {
    println!("[{}] {}", TAG, args);
}
pub fn warn(args: std::fmt::Arguments<'_>) {
    eprintln!("[{}] {}", TAG, args);
}
pub fn error(args: std::fmt::Arguments<'_>) {
    eprintln!("[{}] {}", TAG, args);
}

#[macro_export]
macro_rules! success {
    ($($arg:tt)*) => { $crate::logger::success(format_args!($($arg)*)) };
}
#[macro_export]
macro_rules! info {
    ($($arg:tt)*) => { $crate::logger::info(format_args!($($arg)*)) };
}
#[macro_export]
macro_rules! warn {
    ($($arg:tt)*) => { $crate::logger::warn(format_args!($($arg)*)) };
}
#[macro_export]
macro_rules! error {
    ($($arg:tt)*) => { $crate::logger::error(format_args!($($arg)*)) };
}
