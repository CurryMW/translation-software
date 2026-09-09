# 译文呈现原型（一次性，非生产代码）

在仓库根目录运行：

```sh
/usr/bin/python3 -m http.server 8765 --bind 127.0.0.1 --directory .scratch/web-translation-extension/prototype
```

打开 http://127.0.0.1:8765/?variant=A ，底部切换 A/B/C。也可直接打开 index.html。

所有数据均为预置演示，不接真实翻译 API、不持久化设置。底部选择器只存在于该一次性原型，不进入正式扩展。

问题：如何在保留原文的前提下呈现加载、成功、错误和折叠状态？用户已选定 A「紧凑双语」，详见 [呈现契约](../issues/03-rendering-contract.md)。三个方案暂保留供追溯，分支归档待提交确认；正式实现不可直接照搬原型的全量 DOM 重建方式。
