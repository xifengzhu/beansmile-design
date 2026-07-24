# 微信小程序原生核对清单（真机人工验证）

> 以下项 HTML 原型无法忠实验证（规范 6.3），最终合规须在微信内真机确认，不计入自动化结论。

- [ ] 自定义导航栏为右上角胶囊预留避让，返回主页/关闭可用（`weapp-capsule-safe-area`）
- [ ] tabBar 为原生配置，项数/图标/选中态符合规范（`weapp-tabbar`）
- [ ] picker/scroll-view/swiper/input 等为原生组件，行为与无障碍正常（`weapp-native-components`）
- [ ] 授权弹窗由用户操作在明确场景触发，被拒后有降级路径（`weapp-authorization`）
- [ ] 全面屏底部操作区避让 Home 指示条安全区（`weapp-safe-area-bottom`）
- [ ] 下拉刷新为原生实现，反馈及时、不与系统手势冲突（`weapp-pull-refresh`）
