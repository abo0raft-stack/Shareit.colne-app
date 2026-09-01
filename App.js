import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Alert,
  ActivityIndicator,
  I18nManager
} from 'react-native';

// المكتبات الأساسية
import * as MediaLibrary from 'expo-media-library';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Network from 'expo-network';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import HttpBridge from 'react-native-http-bridge-refurbished';

// دعم RTL للغة العربية
I18nManager.forceRTL(true);

const { width } = Dimensions.get('window');
const COLUMN_SIZE = width / 3 - 12;
const PORT = 8080;

export default function App() {
  // حالة الشاشة الحالية: 'home' | 'receiver' | 'sender_scan' | 'transfer'
  const [currentScreen, setCurrentScreen] = useState('home');
  
  // بيانات الوسائط والملفات المحددة
  const [activeTab, setActiveTab] = useState('photos');
  const [mediaItems, setMediaItems] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  
  // بيانات الشبكة والاتصال
  const [localIp, setLocalIp] = useState('');
  const [targetServer, setTargetServer] = useState({ ip: '', port: PORT });
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  
  // حالة النقل والخادم
  const [isServerRunning, setIsServerRunning] = useState(false);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    getInitialPermissions();
    fetchLocalIp();

    return () => {
      // إيقاف الخادم المحلي عند إغلاق التطبيق
      HttpBridge.stop();
    };
  }, []);

  // 1. طلب الصلاحيات وجلب الـ IP
  const getInitialPermissions = async () => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === 'granted') {
      loadMedia('photo');
    }
  };

  const fetchLocalIp = async () => {
    try {
      const ip = await Network.getIpAddressAsync();
      setLocalIp(ip || '192.168.1.1');
    } catch (e) {
      setLocalIp('192.168.1.1');
    }
  };

  // 2. تحميل الصور/الفيديوهات
  const loadMedia = async (type) => {
    try {
      const mediaType = type === 'photo' ? MediaLibrary.MediaType.photo : MediaLibrary.MediaType.video;
      const { assets } = await MediaLibrary.getAssetsAsync({
        mediaType: [mediaType],
        first: 30,
      });
      setMediaItems(assets);
    } catch (error) {
      console.log('Error loading media:', error);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'photos') loadMedia('photo');
    if (tab === 'videos') loadMedia('video');
  };

  const toggleSelectItem = (item) => {
    const exists = selectedItems.find(i => i.id === item.id);
    if (exists) {
      setSelectedItems(selectedItems.filter(i => i.id !== item.id));
    } else {
      setSelectedItems([...selectedItems, item]);
    }
  };

  // 3. منطق جهاز المستلم (تشغيل خادم HTTP محلي)
  const startReceiverServer = async () => {
    try {
      await fetchLocalIp();
      
      HttpBridge.start(PORT, 'http_service', async (request) => {
        const { type, url, postData } = request;

        if (type === 'POST' && url === '/upload') {
          try {
            const fileName = request.headers['x-file-name'] || `file_${Date.now()}.dat`;
            const destinationUri = `${FileSystem.documentDirectory}${fileName}`;

            if (postData) {
              await FileSystem.writeAsStringAsync(destinationUri, postData.base64 || postData, {
                encoding: FileSystem.EncodingType.Base64,
              });

              setReceivedFiles((prev) => [...prev, fileName]);
              HttpBridge.respond(request.requestId, 200, 'application/json', JSON.stringify({ status: 'success' }));
            }
          } catch (err) {
            HttpBridge.respond(request.requestId, 500, 'application/json', JSON.stringify({ error: err.message }));
          }
        } else {
          HttpBridge.respond(request.requestId, 404, 'text/plain', 'Not Found');
        }
      });

      setIsServerRunning(true);
      setCurrentScreen('receiver');
    } catch (error) {
      Alert.alert('خطأ', 'فشل تشغيل خادم الاستقبال المحلّي: ' + error.message);
    }
  };

  const stopReceiverServer = () => {
    HttpBridge.stop();
    setIsServerRunning(false);
    setCurrentScreen('home');
  };

  // 4. منطق جهاز المرسل (مسح الـ QR والرفع الحقيقي)
  const startSenderScan = async () => {
    if (selectedItems.length === 0) {
      Alert.alert('تنبيه', 'يرجى تحديد ملف واحد على الأقل للإرسال');
      return;
    }
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert('تنبيه', 'يلزم السماح بالكاميرا لمسح الرمز');
        return;
      }
    }
    setCurrentScreen('sender_scan');
  };

  const handleBarCodeScanned = ({ data }) => {
    try {
      const parsedData = JSON.parse(data);
      if (parsedData.ip) {
        setTargetServer({ ip: parsedData.ip, port: parsedData.port || PORT });
        setCurrentScreen('transfer');
        executeRealUpload(parsedData.ip, parsedData.port || PORT);
      }
    } catch (e) {
      Alert.alert('خطأ', 'رمز QR غير صالح للنقل');
    }
  };

  // 5. التنفيذ الحقيقي لرفع الملفات من المرسل إلى المستلم
  const executeRealUpload = async (targetIp, targetPort) => {
    setIsUploading(true);
    setUploadProgress(0);

    const serverUrl = `http://${targetIp}:${targetPort}/upload`;

    for (let i = 0; i < selectedItems.length; i++) {
      const item = selectedItems[i];
      try {
        const uploadTask = FileSystem.createUploadTask(
          serverUrl,
          item.uri,
          {
            headers: { 'x-file-name': item.filename || `upload_${Date.now()}.jpg` },
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.MULTIPART,
            fieldName: 'file',
          },
          (data) => {
            const progress = data.totalBytesSent / data.totalBytesExpectedToSend;
            setUploadProgress(Math.round(progress * 100));
          }
        );

        await uploadTask.uploadAsync();
      } catch (error) {
        Alert.alert('خطأ في النقل', `تعذر نقل الملف: ${error.message}`);
        break;
      }
    }

    setIsUploading(false);
    Alert.alert('نجاح', 'تم إرسال كافة الملفات بنجاح!', [
      { text: 'حسناً', onPress: () => { setSelectedItems([]); setCurrentScreen('home'); } }
    ]);
  };

  // ------------------ الواجهات البرمجية (UI Views) ------------------

  // الشاشة الرئيسية
  if (currentScreen === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerTabs}>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'photos' && styles.activeTabBtn]} onPress={() => handleTabChange('photos')}>
            <Text style={[styles.tabText, activeTab === 'photos' && styles.activeTabText]}>الصور</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tabBtn, activeTab === 'videos' && styles.activeTabBtn]} onPress={() => handleTabChange('videos')}>
            <Text style={[styles.tabText, activeTab === 'videos' && styles.activeTabText]}>الفيديوهات</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.contentArea}>
          <FlatList
            data={mediaItems}
            keyExtractor={(item) => item.id}
            numColumns={3}
            renderItem={({ item }) => {
              const isSelected = selectedItems.some(i => i.id === item.id);
              return (
                <TouchableOpacity style={styles.gridItem} onPress={() => toggleSelectItem(item)}>
                  <Image source={{ uri: item.uri }} style={styles.thumbnail} />
                  {isSelected && <View style={styles.checkmark}><Text style={{ color: '#FFF' }}>✓</Text></View>}
                </TouchableOpacity>
              );
            }}
          />
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.receiveBtn} onPress={startReceiverServer}>
            <Text style={styles.btnText}>استلام</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sendBtn} onPress={startSenderScan}>
            <Text style={styles.btnText}>إرسال ({selectedItems.length})</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // شاشة المستلم (QR + Server)
  if (currentScreen === 'receiver') {
    const qrData = JSON.stringify({ ip: localIp, port: PORT });
    return (
      <View style={styles.centerView}>
        <Text style={styles.title}>جاهز للاستقبال عبر الخادم المحلي</Text>
        <View style={styles.qrContainer}>
          <QRCode value={qrData} size={200} color="#7C3AED" backgroundColor="#FFF" />
        </View>
        <Text style={styles.infoText}>عنوان الجهاز: http://{localIp}:{PORT}</Text>
        
        <Text style={{ marginTop: 15, fontWeight: 'bold' }}>الملفات المستلمة حقيقياً ({receivedFiles.length}):</Text>
        {receivedFiles.map((file, idx) => (
          <Text key={idx} style={{ color: '#10B981' }}>✓ {file}</Text>
        ))}

        <TouchableOpacity style={styles.cancelBtn} onPress={stopReceiverServer}>
          <Text style={{ color: '#374151' }}>إغلاق الخادم والعودة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // شاشة المسح للمرسل
  if (currentScreen === 'sender_scan') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView style={StyleSheet.absoluteFillObject} onBarcodeScanned={handleBarCodeScanned}>
          <View style={styles.cameraOverlay}>
            <View style={styles.scanTarget} />
            <Text style={{ color: '#FFF', marginTop: 15 }}>امسح رمز QR الخاص بالمستلم</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setCurrentScreen('home')}>
              <Text style={{ color: '#374151' }}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  // شاشة تقدم النقل الحقيقي
  if (currentScreen === 'transfer') {
    return (
      <View style={styles.centerView}>
        <Text style={styles.title}>جاري نقل الملفات حقيقياً...</Text>
        <ActivityIndicator size="large" color="#7C3AED" style={{ marginVertical: 20 }} />
        <Text style={styles.progressText}>{uploadProgress}%</Text>
        <Text style={{ color: '#6B7280' }}>الاتصال قائم مع: {targetServer.ip}</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF', paddingTop: StatusBar.currentHeight || 20 },
  headerTabs: { flexDirection: 'row', backgroundColor: '#F3F4F6', margin: 10, borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  activeTabBtn: { backgroundColor: '#7C3AED' },
  tabText: { color: '#4B5563', fontWeight: 'bold' },
  activeTabText: { color: '#FFFFFF' },
  contentArea: { flex: 1, paddingHorizontal: 4 },
  gridItem: { width: COLUMN_SIZE, height: COLUMN_SIZE, margin: 4, borderRadius: 8, overflow: 'hidden' },
  thumbnail: { width: '100%', height: '100%' },
  checkmark: { position: 'absolute', top: 5, right: 5, backgroundColor: '#7C3AED', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  bottomBar: { flexDirection: 'row', padding: 15, borderTopWidth: 1, borderColor: '#EEE', gap: 10 },
  receiveBtn: { flex: 1, backgroundColor: '#10B981', padding: 14, borderRadius: 10, alignItems: 'center' },
  sendBtn: { flex: 2, backgroundColor: '#7C3AED', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  centerView: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#FFF' },
  title: { fontSize: 18, fontWeight: 'bold', color: '#1F2937', marginBottom: 15 },
  qrContainer: { padding: 15, backgroundColor: '#F9FAFB', borderRadius: 12, elevation: 2 },
  infoText: { marginTop: 15, color: '#4B5563', fontSize: 14 },
  cancelBtn: { marginTop: 25, backgroundColor: '#E5E7EB', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  cameraOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  scanTarget: { width: 220, height: 220, borderWidth: 2, borderColor: '#7C3AED', borderRadius: 12 },
  progressText: { fontSize: 32, fontWeight: 'bold', color: '#7C3AED', marginVertical: 10 }
});
