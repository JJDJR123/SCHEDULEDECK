# 报错

程序自己报上来的错误，按**账号**分文件夹：

```
报错/
  杨浩源/
    a1b2c3d4e5.json
```

**同一个错误只留一个文件**（按错误签名的哈希命名），里面的结构：

```json
{
  "signature": "update-check: HTTP 404",
  "user": "杨浩源",
  "count": 12,          // 一共出现多少次（不只 5 次）
  "firstAt": "2026-10-22T01:40:00.000Z",
  "lastAt":  "2026-10-22T02:10:00.000Z",
  "samples": [           // 最多 5 条，超出只累计 count
    { "at": "...", "message": "...", "version": "1.0.20261022014000" }
  ]
}
```

## 怎么收进来

app 把错误先写到本机：

```
<exe 同级>\data\errors\<账号>\<签名哈希>.json
```

在仓库里跑：

```powershell
powershell -File tools\collect-errors.ps1
```

会复制到本文件夹（同名覆盖），然后 commit。

## 注意

错误信息里可能带表名、路径等内部信息。**别放公开仓库**。
