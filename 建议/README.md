# 建议

来自使用者的建议，**按人分文件夹**：

```
建议/
  杨浩源/
    2026-10-22T00-52-11-123Z.json
  张三/
    ...
```

每个文件就是提交时那段 JSON，外面包了一层元信息：

```json
{
  "from": "杨浩源",
  "at": "2026-10-22T00:52:11.123Z",
  "app": { "version": "1.0.20261022005211", "stamp": "20261022005211" },
  "suggestion": { "title": "...", "type": "功能建议", "content": "...", "scene": "..." }
}
```

## 怎么从 app 收进来

点右上角「我有个想法🤓👆」提交，文件会先落在本机：

```
<exe 同级>\data\suggestions\<名字>\<时间戳>.json
```

攒够了在仓库里跑一次：

```powershell
powershell -File tools\collect-suggestions.ps1
```

它会把 `打包成品\data\suggestions\*` 复制到这里（同名覆盖），然后 commit 就行。

## 注意

里面很可能写了内部信息（排期、人名、表结构）。**仓库保持 Private**，别公开。
