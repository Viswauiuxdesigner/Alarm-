# ProGuard rules for Duo Alarm App
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.duoremind.alarm.DuoNativeBridge { *; }
