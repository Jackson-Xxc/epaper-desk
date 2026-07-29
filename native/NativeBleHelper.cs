using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.Advertisement;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Devices.Enumeration;
using Windows.Foundation;
using Windows.Storage.Streams;

internal static class NativeBleHelper
{
    private sealed class DeviceTarget
    {
        public ulong Address;
        public BluetoothAddressType AddressType;
        public string Name;
    }

    private sealed class DeviceConnection
    {
        public BluetoothLEDevice Device;
        public GattDeviceService Service;
    }

    private static readonly Guid ServiceUuid = new Guid("62750001-d828-918d-fb46-b6c11c675aec");
    private static readonly Guid CharacteristicUuid = new Guid("62750002-d828-918d-fb46-b6c11c675aec");
    private const byte InitCommand = 0x01;
    private const byte RefreshCommand = 0x05;
    private const byte WriteImageCommand = 0x30;
    private static int notifiedMtu = 0;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.InputEncoding = new UTF8Encoding(false);
            if (args.Length < 1 || !String.Equals(args[0], "send", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Usage: NativeBleHelper.exe send --prefix NRF_EPD --black black.bin --red red.bin");

            var options = ParseOptions(args.Skip(1).ToArray());
            var prefix = GetRequired(options, "prefix");
            var black = File.ReadAllBytes(GetRequired(options, "black"));
            var red = File.ReadAllBytes(GetRequired(options, "red"));
            if (black.Length == 0 || red.Length == 0 || black.Length != red.Length)
                throw new InvalidDataException("图像色层数据无效");

            SendAsync(prefix, black, red).GetAwaiter().GetResult();
            Emit("complete", 100, "Windows 原生 BLE 传输完成");
            return 0;
        }
        catch (Exception error)
        {
            Emit("error", -1, FlattenError(error));
            return 1;
        }
    }

    private static Dictionary<string, string> ParseOptions(string[] args)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index + 1 < args.Length; index += 2)
        {
            var key = args[index].TrimStart('-');
            result[key] = args[index + 1];
        }
        return result;
    }

    private static string GetRequired(Dictionary<string, string> options, string key)
    {
        string value;
        if (!options.TryGetValue(key, out value) || String.IsNullOrWhiteSpace(value))
            throw new ArgumentException("缺少参数 --" + key);
        return value;
    }

    private static async Task SendAsync(string prefix, byte[] black, byte[] red)
    {
        Emit("status", 0, "正在通过 WinRT 扫描 " + prefix);
        var target = await FindDeviceAsync(prefix, TimeSpan.FromSeconds(15));
        Emit("status", 2, "已发现设备 " + target.Name + " " + FormatAddress(target.Address)
            + "（" + target.AddressType + "）");

        Exception lastError = null;
        for (var attempt = 1; attempt <= 2; attempt++)
        {
            try
            {
                notifiedMtu = 0;
                if (attempt > 1)
                    Emit("status", 1, "正在重新建立完整原生 BLE 会话（第 2/2 次）");
                await TransferOnceAsync(target, prefix, black, red);
                return;
            }
            catch (Exception error)
            {
                lastError = error;
                Emit("status", -1, "第 " + attempt + "/2 次原生传输中断：" + FlattenError(error));
            }
            if (attempt < 2) await Task.Delay(1800);
        }
        throw new InvalidOperationException("Windows 原生 BLE 两次完整传输均失败", lastError);
    }

    private static async Task TransferOnceAsync(
        DeviceTarget target,
        string prefix,
        byte[] black,
        byte[] red
    )
    {
        BluetoothLEDevice device = null;
        GattDeviceService service = null;
        GattCharacteristic characteristic = null;
        try
        {
            var connection = await ConnectDeviceAsync(target);
            device = connection.Device;
            service = connection.Service;
            Emit("status", 4, "WinRT 已打开 BLE 设备：" + (device.Name ?? prefix));
            service.Session.MaintainConnection = true;

            var characteristicResult = await service.GetCharacteristicsForUuidAsync(
                CharacteristicUuid,
                BluetoothCacheMode.Uncached
            ).AsTask();
            if (characteristicResult.Status != GattCommunicationStatus.Success || characteristicResult.Characteristics.Count == 0)
                throw new InvalidOperationException("无法获取 EPD GATT Characteristic：" + characteristicResult.Status);
            characteristic = characteristicResult.Characteristics[0];

            characteristic.ValueChanged += OnValueChanged;
            var notifyStatus = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue.Notify
            ).AsTask();
            Emit("status", 5, "通知订阅状态：" + notifyStatus);
            await Task.Delay(350);

            await WriteAsync(characteristic, new byte[] { InitCommand }, true);
            await Task.Delay(350);

            var maxPdu = Math.Max(23, (int)service.Session.MaxPduSize);
            var imageBytesPerPacket = notifiedMtu > 20
                ? notifiedMtu - 2
                : Math.Max(18, maxPdu - 5);
            imageBytesPerPacket = Math.Min(242, imageBytesPerPacket);
            Emit("status", 6, "WinRT PDU " + maxPdu + "，图像数据 " + imageBytesPerPacket + " 字节/包");

            await SendPlaneAsync(characteristic, black, 0x0f, 0, imageBytesPerPacket);
            await SendPlaneAsync(characteristic, red, 0x00, 1, imageBytesPerPacket);
            Emit("status", 98, "正在发送原生刷新命令");
            await Task.Delay(250);
            await WriteAsync(characteristic, new byte[] { RefreshCommand }, true);
            await Task.Delay(350);
        }
        finally
        {
            if (characteristic != null) characteristic.ValueChanged -= OnValueChanged;
            if (service != null)
            {
                service.Session.MaintainConnection = false;
                service.Dispose();
            }
            if (device != null) device.Dispose();
        }
    }

    private static async Task<DeviceTarget> FindDeviceAsync(string prefix, TimeSpan timeout)
    {
        var completion = new TaskCompletionSource<DeviceTarget>();
        var watcher = new BluetoothLEAdvertisementWatcher
        {
            ScanningMode = BluetoothLEScanningMode.Active
        };
        TypedEventHandler<BluetoothLEAdvertisementWatcher, BluetoothLEAdvertisementReceivedEventArgs> handler = null;
        handler = (sender, eventArgs) =>
        {
            var name = eventArgs.Advertisement.LocalName ?? "";
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                completion.TrySetResult(new DeviceTarget
                {
                    Address = eventArgs.BluetoothAddress,
                    AddressType = eventArgs.BluetoothAddressType,
                    Name = name
                });
            }
        };
        watcher.Received += handler;
        watcher.Start();
        try
        {
            var finished = await Task.WhenAny(completion.Task, Task.Delay(timeout));
            if (finished != completion.Task)
            {
                Emit("status", 1, "实时广播未发现设备，正在查询 Windows 已知 BLE 设备");
                var cachedTarget = await FindCachedDeviceAsync(prefix);
                if (cachedTarget != null)
                {
                    Emit("status", 2, "已从 Windows 缓存找到 " + cachedTarget.Name);
                    return cachedTarget;
                }
                throw new TimeoutException("15 秒内未发现 " + prefix
                    + "，Windows 缓存中也没有该设备；请让墨水屏重新进入广播状态");
            }
            return await completion.Task;
        }
        finally
        {
            watcher.Stop();
            watcher.Received -= handler;
        }
    }

    private static async Task<DeviceTarget> FindCachedDeviceAsync(string prefix)
    {
        var devices = await DeviceInformation.FindAllAsync(
            BluetoothLEDevice.GetDeviceSelector()
        ).AsTask();
        foreach (var info in devices)
        {
            if (String.IsNullOrWhiteSpace(info.Name)
                || !info.Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                continue;

            BluetoothLEDevice device = null;
            try
            {
                device = await BluetoothLEDevice.FromIdAsync(info.Id).AsTask();
                if (device == null) continue;
                return new DeviceTarget
                {
                    Address = device.BluetoothAddress,
                    AddressType = device.BluetoothAddressType,
                    Name = String.IsNullOrWhiteSpace(device.Name) ? info.Name : device.Name
                };
            }
            catch
            {
            }
            finally
            {
                if (device != null) device.Dispose();
            }
        }
        return null;
    }

    private static async Task<DeviceConnection> ConnectDeviceAsync(DeviceTarget target)
    {
        Exception lastError = null;
        var delays = new[] { 0, 1500, 3000, 5000 };
        for (var attempt = 0; attempt < delays.Length; attempt++)
        {
            if (delays[attempt] > 0) await Task.Delay(delays[attempt]);
            BluetoothLEDevice device = null;
            try
            {
                device = await BluetoothLEDevice.FromBluetoothAddressAsync(
                    target.Address,
                    target.AddressType
                ).AsTask();
                if (device == null) throw new InvalidOperationException("WinRT 返回空设备对象");

                var access = await device.RequestAccessAsync().AsTask();
                if (access != DeviceAccessStatus.Allowed)
                    throw new UnauthorizedAccessException("Windows 蓝牙访问状态：" + access);

                var serviceResult = await device.GetGattServicesForUuidAsync(
                    ServiceUuid,
                    BluetoothCacheMode.Uncached
                ).AsTask();
                if (serviceResult.Status == GattCommunicationStatus.Success
                    && serviceResult.Services.Count > 0)
                {
                    return new DeviceConnection
                    {
                        Device = device,
                        Service = serviceResult.Services[0]
                    };
                }
                throw new InvalidOperationException("EPD GATT Service：" + serviceResult.Status);
            }
            catch (Exception error)
            {
                lastError = error;
                if (device != null) device.Dispose();
            }
            Emit("status", 3, "原生 GATT 第 " + (attempt + 1) + "/" + delays.Length
                + " 次失败：" + FlattenError(lastError));
        }
        throw new InvalidOperationException("Windows 原生 BLE 无法连接设备", lastError);
    }

    private static async Task SendPlaneAsync(
        GattCharacteristic characteristic,
        byte[] data,
        byte firstFlag,
        int planeIndex,
        int dataPerPacket
    )
    {
        var packetIndex = 0;
        for (var offset = 0; offset < data.Length; offset += dataPerPacket)
        {
            var count = Math.Min(dataPerPacket, data.Length - offset);
            var payload = new byte[count + 2];
            payload[0] = WriteImageCommand;
            payload[1] = offset == 0 ? firstFlag : (byte)(firstFlag | 0xf0);
            System.Buffer.BlockCopy(data, offset, payload, 2, count);
            var isLast = offset + count >= data.Length;
            var packetNumber = packetIndex + 1;
            var withResponse = packetNumber % 51 == 0 || isLast;
            try
            {
                // Let the WinRT write queue drain before switching from
                // WriteWithoutResponse to the protocol's confirmation packet.
                if (withResponse) await Task.Delay(180);
                await WriteAsync(characteristic, payload, withResponse);
            }
            catch (Exception error)
            {
                var planeName = planeIndex == 0 ? "黑白层" : "红色层";
                var writeMode = withResponse ? "确认写入" : "无响应写入";
                throw new IOException(
                    planeName + "第 " + packetNumber + " 包（" + writeMode + "）失败",
                    error
                );
            }
            packetIndex++;

            if (packetIndex == 1 || packetIndex % 8 == 0 || isLast)
            {
                var percent = (int)Math.Round(
                    ((planeIndex * data.Length + Math.Min(data.Length, offset + count))
                    / (double)(data.Length * 2)) * 96.0
                ) + 2;
                Emit("progress", percent, (planeIndex == 0 ? "黑白层" : "红色层") + " 第 " + packetIndex + " 包");
            }
            await Task.Delay(withResponse ? 40 : (packetNumber % 50 == 0 ? 100 : 6));
        }
        await Task.Delay(180);
    }

    private static async Task WriteAsync(
        GattCharacteristic characteristic,
        byte[] payload,
        bool withResponse
    )
    {
        var option = withResponse ? GattWriteOption.WriteWithResponse : GattWriteOption.WriteWithoutResponse;
        var status = await characteristic.WriteValueAsync(payload.AsBuffer(), option).AsTask();
        if (status != GattCommunicationStatus.Success)
            throw new IOException("WinRT GATT 写入失败：" + status);
    }

    private static void OnValueChanged(
        GattCharacteristic sender,
        GattValueChangedEventArgs args
    )
    {
        try
        {
            var bytes = new byte[args.CharacteristicValue.Length];
            using (var reader = DataReader.FromBuffer(args.CharacteristicValue))
                reader.ReadBytes(bytes);
            var message = Encoding.UTF8.GetString(bytes).Trim('\0', ' ', '\r', '\n');
            if (message.StartsWith("mtu=", StringComparison.OrdinalIgnoreCase))
            {
                int value;
                if (Int32.TryParse(message.Substring(4), out value))
                    notifiedMtu = value;
            }
            Emit("device", -1, "设备通知：" + BitConverter.ToString(bytes).Replace("-", ""));
        }
        catch
        {
        }
    }

    private static string FormatAddress(ulong address)
    {
        var hex = address.ToString("X12");
        return String.Join(":", Enumerable.Range(0, 6).Select(index => hex.Substring(index * 2, 2)));
    }

    private static string FlattenError(Exception error)
    {
        var messages = new List<string>();
        for (var current = error; current != null; current = current.InnerException)
            if (!String.IsNullOrWhiteSpace(current.Message)) messages.Add(current.Message);
        return String.Join(" → ", messages);
    }

    private static void Emit(string type, int percent, string message)
    {
        Console.WriteLine(
            "{\"type\":\"" + Escape(type) + "\",\"percent\":" + percent
            + ",\"message\":\"" + Escape(message) + "\"}"
        );
        Console.Out.Flush();
    }

    private static string Escape(string value)
    {
        return (value ?? "")
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n");
    }
}
