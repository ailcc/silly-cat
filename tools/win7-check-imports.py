#!/usr/bin/env python3
"""静态检查 Windows 可执行文件的导入表：有没有引用 Windows 7 上不存在的系统接口。

只能发现「链接时就写进导入表」的依赖，运行时用 GetProcAddress 动态取的看不到，
所以通过只说明没有明显问题，不等于一定能在 Win7 上运行，最终以真机为准。
"""
import sys
import pefile

# Windows 上 Python 默认按系统代码页输出（如 cp1252），中文会抛 UnicodeEncodeError
sys.stdout.reconfigure(encoding="utf-8")

# Windows 8 及以后才有的接口，Rust 1.78+ 的标准库和较新的 windows crate 会用到
BAD_SYMBOLS = {
    "WaitOnAddress", "WakeByAddressSingle", "WakeByAddressAll",
    "GetSystemTimePreciseAsFileTime", "SetThreadDescription", "GetThreadDescription",
    "PackageIdFromFullName", "GetPackagesByPackageFamily", "GetCurrentPackageFamilyName",
    "GetCurrentPackageId", "GetPackageFamilyName", "ProcessPrng",
    "PrefetchVirtualMemory", "DiscardVirtualMemory", "SetProcessMitigationPolicy",
}
# Windows 8 才引入的 API Set 名（Win7 没有这些转发 DLL）
BAD_DLLS = {
    "api-ms-win-core-synch-l1-2-0.dll",
    "api-ms-win-core-winrt-l1-1-0.dll",
    "api-ms-win-core-winrt-string-l1-1-0.dll",
    "api-ms-win-core-winrt-error-l1-1-0.dll",
    "api-ms-win-core-winrt-robuffer-l1-1-0.dll",
    "bcryptprimitives.dll",  # 只为 ProcessPrng 而链接
}


def entries(pe):
    for attr in ("DIRECTORY_ENTRY_IMPORT", "DIRECTORY_ENTRY_DELAY_IMPORT"):
        kind = "导入" if attr == "DIRECTORY_ENTRY_IMPORT" else "延迟导入"
        for entry in getattr(pe, attr, []):
            dll = entry.dll.decode("ascii", "replace").lower()
            names = [i.name.decode("ascii", "replace") for i in entry.imports if i.name]
            yield kind, dll, names


def main(path):
    pe = pefile.PE(path)
    machine = hex(pe.FILE_HEADER.Machine)
    major = pe.OPTIONAL_HEADER.MajorOperatingSystemVersion
    minor = pe.OPTIONAL_HEADER.MinorOperatingSystemVersion
    sub_major = pe.OPTIONAL_HEADER.MajorSubsystemVersion
    sub_minor = pe.OPTIONAL_HEADER.MinorSubsystemVersion
    print(f"文件: {path}")
    print(f"机器类型 {machine}；要求的系统版本 {major}.{minor}；子系统版本 {sub_major}.{sub_minor}（6.1 = Win7，10.0 = Win10）")
    bad = []
    total = 0
    for kind, dll, names in entries(pe):
        total += len(names)
        print(f"- [{kind}] {dll}: {len(names)} 个接口")
        if dll in BAD_DLLS:
            bad.append(f"{kind} DLL {dll}（Win8 及以后才有）")
        for n in names:
            if n in BAD_SYMBOLS:
                bad.append(f"{kind} {dll}!{n}")
    print(f"共 {total} 个按名字导入的接口")
    if (sub_major, sub_minor) > (6, 1):
        bad.append(f"子系统版本 {sub_major}.{sub_minor} 高于 Win7 的 6.1")
    if bad:
        print("\n发现 Win7 上可能不存在的依赖：")
        for b in bad:
            print("  ✗", b)
        return 1
    print("\n导入表里没有发现已知的 Win8+ 接口。")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("用法: win7-check-imports.py <exe>")
    sys.exit(main(sys.argv[1]))
