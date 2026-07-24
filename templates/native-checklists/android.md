# Android 原生核对清单（真机/模拟器人工验证）

> 以下项 HTML 原型无法忠实验证（规范 6.3），最终合规须人工在设备确认，不计入自动化结论。

- [ ] 系统返回手势/按钮正确响应，预测式返回动画正常（`material-predictive-back`）
- [ ] 边到边布局下状态栏/导航栏 insets 正确，内容不被系统栏遮挡（`material-edge-to-edge`）
- [ ] 动态颜色（Material You）切换后语义色与对比仍成立（`material-dynamic-color`）
- [ ] 可点击目标真机测量 ≥48×48dp（`material-target-size-48dp`）
- [ ] 交互状态层（涟漪/pressed/focus）反馈可见（`material-state-layers`）
- [ ] navigation bar/rail/drawer 选用与当前位置状态正确（`material-navigation-components`）
