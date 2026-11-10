// 桌面端入口。Windows release 下不额外弹控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    intx_lib::run();
}
