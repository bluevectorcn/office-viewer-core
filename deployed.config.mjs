/*
 * @Description:
 * @Author: 沈勇
 * @Date: 2026-09-22 16:29:39
 * @LastEditors: 沈勇
 * @LastEditTime: 2026-09-22 18:51:59
 */
/*
 * 部署配置（与 public 同级）
 *
 * 该文件会在构建时被拷贝到 dist 根目录，并在运行时由 app 动态加载，
 * 因此部署后可直接修改 dist/deployed.config.mjs 而无需重新构建。
 *
 * logoJump: 点击编辑器内 Logo 时跳转的地址。
 *           留空则使用默认地址 https://www.airedgesoft.com
 *
 * customerName: 客户名称，显示在编辑器“关于”弹窗中。
 *               留空则使用默认名称“智研工软”
 *
 * showLogo: 是否展示编辑器 Logo，默认 true。
 *           设为 false 时强制隐藏（即使 public/logo.png 存在）
 */
export const deployedConfig = {
  logoJump: '',
  customerName: '',
  showLogo: false,
};
