import { useState, useEffect } from 'react';

// ⚠️ غيّر هذا الرابط حسب منفذ الباك إند عندك
const const API_URL = 'https://athar-accounting.up.railway.app/api/accounts';

function App() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    type: 'income', // income or expense
    amount: '',
    date: ''
  });

  // 1. دالة لجلب البيانات من الباك إند عند تحميل الصفحة
  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const response = await fetch(API_URL);
      const data = await response.json();
      setAccounts(data);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      alert("فشل الاتصال بالباك إند، تأكد أن السيرفر شغال");
    } finally {
      setLoading(false);
    }
  };

  // 2. دالة لإضافة حساب جديد
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        setFormData({ name: '', type: 'income', amount: '', date: '' });
        fetchAccounts(); // تحديث القائمة بعد الإضافة
      } else {
        alert("حدث خطأ أثناء الإضافة");
      }
    } catch (error) {
      console.error(error);
      alert("خطأ في الاتصال");
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <h1 className="text-3xl font-bold text-center text-blue-600 mb-8">
        نظام أثّار المحاسبي
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto">
        
        {/* القسم الأيسر: نموذج الإضافة */}
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h2 className="text-xl font-semibold mb-4">إضافة سجل جديد</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              placeholder="اسم الحساب/البيان"
              className="w-full p-2 border rounded"
              value={formData.name}
              onChange={(e) => setFormData({...formData, name: e.target.value})}
              required
            />
            <select
              className="w-full p-2 border rounded"
              value={formData.type}
              onChange={(e) => setFormData({...formData, type: e.target.value})}
            >
              <option value="income">إيراد (دخل)</option>
              <option value="expense">مصروف</option>
            </select>
            <input
              type="number"
              placeholder="المبلغ"
              className="w-full p-2 border rounded"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
              required
            />
            <input
              type="date"
              className="w-full p-2 border rounded"
              value={formData.date}
              onChange={(e) => setFormData({...formData, date: e.target.value})}
              required
            />
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
            >
              إضافة الحساب
            </button>
          </form>
        </div>

        {/* القسم الأيمن: جدول عرض البيانات */}
        <div className="bg-white p-6 rounded-lg shadow-lg overflow-x-auto">
          <h2 className="text-xl font-semibold mb-4">سجل الحسابات</h2>
          {loading ? (
            <p className="text-gray-500 text-center">جاري تحميل البيانات...</p>
          ) : accounts.length === 0 ? (
            <p className="text-gray-500 text-center">لا توجد سجلات حالياً</p>
          ) : (
            <table className="w-full text-right">
              <thead>
                <tr className="border-b">
                  <th className="pb-2">الاسم</th>
                  <th className="pb-2">النوع</th>
                  <th className="pb-2">المبلغ</th>
                  <th className="pb-2">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.id} className="border-b hover:bg-gray-50">
                    <td className="py-2">{acc.name}</td>
                    <td className="py-2">
                      <span className={`px-2 py-1 rounded text-xs ${
                        acc.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {acc.type === 'income' ? 'إيراد' : 'مصروف'}
                      </span>
                    </td>
                    <td className="py-2 font-bold">{acc.amount}</td>
                    <td className="py-2">{acc.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;