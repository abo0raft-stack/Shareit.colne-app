# 🚀 SHAREit Clone - React Native (Expo SDK 51)

تطبيق لنقل الملفات الحقيقية (صور، فيديوهات، مستندات) بين الأجهزة بدون إنترنت عبر شبكة Wi-Fi المحلية واكتشاف الأجهزة باستخدام رمز QR.

## 📱 الميزات الرئيسية
- 📷 جلب وسائط المعرض الحقيقية من الهاتف عبر `expo-media-library`.
- 🌐 إنشاء خادم HTTP محلي تلقائيًا على جهاز المستلم واستقبال الملفات.
- 📡 استخراج الـ IP المحلي للجهاز عبر `expo-network`.
- 🔲 توليد وقراءة رمز الـ QR باستخدام الكاميرا للربط السريع بين الجهازين.
- ⚡ إرسال حقيقي للملفات كبايتات باستخدام `FileSystem.createUploadTask`.
- 🎨 واجهة مستخدم كاملة باللغة العربية (RTL) بطابع اللون البنفسجي (`#7C3AED`).

## 🛠️ التثبيت والتشغيل

1. **استنسخ المستودع:**
   ```bash
   git clone [https://github.com/your-username/shareit-clone.git](https://github.com/your-username/shareit-clone.git)
   cd shareit-clone
