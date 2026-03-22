import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import * as XLSX from 'xlsx';
import {
  LayoutDashboard, FileText, MessageSquare,
  ChevronRight, Star, Users, Plus, Trash2,
  Download, Search, Filter, ChevronLeft, X, Check, AlertCircle,
  TrendingUp, RefreshCw, Eye, EyeOff, Save, Edit3,
  BarChart3, Activity, ArrowUpDown, Calendar, 
  ThumbsUp, ThumbsDown, MessageCircle, Sparkles,
  Heart, Send, CheckCircle2, Circle, ArrowRight,
  ClipboardList, HeartPulse, Shield, Award, ChevronDown, FileSpreadsheet
} from 'lucide-react';

const isAdmin = window.location.pathname.startsWith('/admin');

function App() {
  return (
    <>
      <ToastContainer position="top-right" autoClose={3000} />
      {isAdmin ? <AdminDashboard /> : <SurveyPage />}
    </>
  );
}

function StarRating({ value, min = 1, max = 5, onChange, size = 'md' }) {
  const stars = [];
  for (let i = min; i <= max; i += 1) stars.push(i);
  const sizes = { xs: 'w-4 h-4', sm: 'w-5 h-5', md: 'w-7 h-7', lg: 'w-9 h-9', xl: 'w-11 h-11' };
  const sizeClass = sizes[size] || sizes.md;

  return (
    <div className="flex gap-1">
      {stars.map((starValue) => {
        const active = starValue <= (Number(value) || 0);
        return (
          <button
            key={starValue}
            type="button"
            onClick={() => onChange && onChange(starValue)}
            className={`${sizeClass} transition-all duration-200 hover:scale-110 ${
              active ? 'text-amber-400 drop-shadow-sm' : 'text-gray-300 hover:text-amber-200'
            }`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2.6l2.9 5.9 6.6 1-4.8 4.6 1.1 6.5L12 17.5 6.2 20.6l1.1-6.5L2.5 9.5l6.6-1L12 2.6z" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function SurveyPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || params.get('t');

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [isFinished, setIsFinished] = React.useState(false);
  const [finishReason, setFinishReason] = React.useState('');
  const [patientName, setPatientName] = React.useState('');
  const [doctors, setDoctors] = React.useState([]);
  const [questions, setQuestions] = React.useState([]);
  const [ratings, setRatings] = React.useState({});
  const [questionAnswers, setQuestionAnswers] = React.useState({});
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);

  const totalPages = React.useMemo(() => {
    if (questions.length === 0) return 1;
    const pages = questions.map(q => q.page_number || 1);
    return Math.max(...pages);
  }, [questions]);

  const questionsOnPage = React.useMemo(() => {
    return questions.filter(q => (q.page_number || 1) === currentPage);
  }, [questions, currentPage]);

  React.useEffect(() => {
    async function loadSurvey() {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/survey?token=' + encodeURIComponent(token));
        const data = await res.json();
        if (!res.ok || data.error) {
          const apiError = data.error || 'Unable to load survey';
          if (apiError === 'used_token') {
            setIsFinished(true);
            setFinishReason('used');
            setError('');
            return;
          }
          throw new Error(apiError);
        }

        setPatientName(data.patient_name || 'N/A');
        setDoctors(data.doctors || []);
        setQuestions(data.questions || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    loadSurvey();
  }, [token]);

  function setQuestionValue(id, value) {
    setQuestionAnswers((prev) => ({ ...prev, [id]: value }));
  }

  function toggleMultiChoice(id, option) {
    setQuestionAnswers((prev) => {
      const current = Array.isArray(prev[id]) ? prev[id] : [];
      const exists = current.includes(option);
      const next = exists ? current.filter((x) => x !== option) : [...current, option];
      return { ...prev, [id]: next };
    });
  }

  function validateForm() {
    if (currentPage === 1) {
      for (const d of doctors) {
        if (!Number.isInteger(ratings[d.id])) return 'Please rate every doctor.';
      }
    }

    for (const q of questionsOnPage) {
      if (q.required && !(q.id in questionAnswers)) return 'Please answer all required questions on this page.';
    }

    return '';
  }

  function canGoNext() {
    if (currentPage === 1) {
      for (const d of doctors) {
        if (!Number.isInteger(ratings[d.id])) return false;
      }
    }
    for (const q of questionsOnPage) {
      if (q.required && !(q.id in questionAnswers)) return false;
    }
    return true;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        token,
        ratings: Object.keys(ratings).map((doctorId) => ({ doctor_id: doctorId, rating: ratings[doctorId] })),
        question_answers: questionAnswers,
        comment: comment || null
      };

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        const apiError = data.error || 'Submit failed';
        if (apiError === 'used_token') {
          setIsFinished(true);
          setFinishReason('used');
          setError('');
          return;
        }
        throw new Error(apiError);
      }

      setIsFinished(true);
      setFinishReason('submitted');
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function renderQuestionInput(q) {
    const value = questionAnswers[q.id];

    if (q.type === 'text') {
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setQuestionValue(q.id, e.target.value)}
          placeholder="Share your thoughts with us..."
          className="w-full p-5 border-2 border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 resize-none transition-all text-gray-700"
          rows={4}
        />
      );
    }

    if (q.type === 'number') {
      return (
        <input
          type="number"
          value={value ?? ''}
          min={q.min ?? undefined}
          max={q.max ?? undefined}
          onChange={(e) => setQuestionValue(q.id, e.target.value === '' ? '' : Number(e.target.value))}
          placeholder="Enter a number"
          className="w-full p-5 border-2 border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 transition-all text-gray-700"
        />
      );
    }

    if (q.type === 'yes_no') {
      return (
        <div className="flex gap-4 justify-center">
          <button
            key="yes"
            type="button"
            onClick={() => setQuestionValue(q.id, 'yes')}
            className={`flex-1 max-w-[180px] py-6 rounded-2xl font-bold transition-all flex flex-col items-center gap-2 ${
              value === 'yes'
                ? 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-xl shadow-emerald-200 scale-105'
                : 'bg-gray-50 text-gray-600 hover:bg-emerald-50 hover:text-emerald-600 border-2 border-transparent hover:border-emerald-200'
            }`}
          >
            <ThumbsUp className="w-10 h-10" />
            <span className="text-lg">Yes</span>
          </button>
          <button
            key="no"
            type="button"
            onClick={() => setQuestionValue(q.id, 'no')}
            className={`flex-1 max-w-[180px] py-6 rounded-2xl font-bold transition-all flex flex-col items-center gap-2 ${
              value === 'no'
                ? 'bg-gradient-to-br from-red-400 to-red-600 text-white shadow-xl shadow-red-200 scale-105'
                : 'bg-gray-50 text-gray-600 hover:bg-red-50 hover:text-red-600 border-2 border-transparent hover:border-red-200'
            }`}
          >
            <ThumbsDown className="w-10 h-10" />
            <span className="text-lg">No</span>
          </button>
        </div>
      );
    }

    if (q.type === 'single_choice') {
      return (
        <div className="grid grid-cols-2 gap-3">
          {(q.options || []).map((opt, idx) => (
            <button
              key={opt}
              type="button"
              onClick={() => setQuestionValue(q.id, opt)}
              className={`py-4 px-4 rounded-2xl font-semibold transition-all flex items-center justify-center gap-3 ${
                value === opt
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-gray-50 text-gray-700 hover:bg-blue-50 hover:text-blue-600 border-2 border-gray-100 hover:border-blue-200'
              }`}
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                value === opt ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-600'
              }`}>
                {String.fromCharCode(65 + idx)}
              </span>
              {opt}
            </button>
          ))}
        </div>
      );
    }

    if (q.type === 'multi_choice') {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="grid grid-cols-2 gap-3">
          {(q.options || []).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggleMultiChoice(q.id, opt)}
              className={`py-4 px-4 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 ${
                selected.includes(opt)
                  ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-200'
                  : 'bg-gray-50 text-gray-700 hover:bg-violet-50 hover:text-violet-600 border-2 border-gray-100 hover:border-violet-200'
              }`}
            >
              {selected.includes(opt) && <Check className="w-5 h-5" />}
              {opt}
            </button>
          ))}
        </div>
      );
    }

    const min = Number.isFinite(q.min) ? q.min : 1;
    const max = Number.isFinite(q.max) ? q.max : 5;
    return (
      <div className="flex flex-col items-center gap-4">
        <StarRating value={value} min={min} max={max} onChange={(next) => setQuestionValue(q.id, next)} size="xl" />
        <span className="text-base text-gray-500 font-medium">
          {value ? `${value} out of ${max}` : `Tap to rate (${min}-${max})`}
        </span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent rounded-full border-t-blue-500 animate-spin"></div>
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Loading Survey</h2>
          <p className="text-gray-500">Please wait...</p>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl p-12 max-w-md w-full text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-red-100 to-red-200 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-12 h-12 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-3">Survey Not Found</h2>
          <p className="text-gray-500 mb-6">Please use the survey link sent to your phone or email.</p>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-sm text-gray-500">If you believe this is an error, please contact support.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-emerald-50 to-teal-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden max-w-lg w-full">
          <div className="bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-8 py-12 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-white opacity-10"></div>
            <div className="absolute -top-20 -right-20 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-20 -left-20 w-32 h-32 bg-teal-400/20 rounded-full blur-2xl"></div>
            <div className="relative z-10">
              <div className="relative mx-auto mb-6 w-28 h-28">
                <div className="w-28 h-28 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm animate-pulse">
                  <Sparkles className="w-14 h-14 text-white" />
                </div>
                <div className="absolute -top-2 -right-2 w-10 h-10 bg-amber-400 rounded-full flex items-center justify-center shadow-lg animate-bounce">
                  <Check className="w-6 h-6 text-white" />
                </div>
              </div>
              <h2 className="text-3xl font-bold mb-3">Thank You!</h2>
              <p className="text-emerald-100 text-lg">
                {finishReason === 'submitted' 
                  ? 'Your feedback has been submitted successfully!' 
                  : 'This survey has already been completed.'}
              </p>
            </div>
          </div>
          
          <div className="p-8">
            <div className="flex justify-center gap-6 mb-8">
              <div className="text-center">
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <MessageSquare className="w-7 h-7 text-blue-500" />
                </div>
                <p className="text-sm text-gray-500">Feedback</p>
                <p className="font-bold text-gray-800">Received</p>
              </div>
              <div className="w-px bg-gray-200"></div>
              <div className="text-center">
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Heart className="w-7 h-7 text-emerald-500" />
                </div>
                <p className="text-sm text-gray-500">Your Voice</p>
                <p className="font-bold text-gray-800">Matters</p>
              </div>
              <div className="w-px bg-gray-200"></div>
              <div className="text-center">
                <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <TrendingUp className="w-7 h-7 text-purple-500" />
                </div>
                <p className="text-sm text-gray-500">Better</p>
                <p className="font-bold text-gray-800">Services</p>
              </div>
            </div>
            
            <p className="text-center text-gray-500">
              {finishReason === 'submitted' 
                ? 'Your response will help us improve our healthcare services. We appreciate your time!'
                : 'Each survey can only be submitted once. Thank you for your understanding.'}
            </p>
            
            <div className="mt-8 flex justify-center">
              <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl px-6 py-4 flex items-center gap-3">
                <Shield className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-500">Your response is confidential</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 px-8 py-12 relative overflow-hidden">
            <div className="absolute inset-0 bg-grid-pattern opacity-10"></div>
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-white/10 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-12 -left-12 w-36 h-36 bg-purple-400/20 rounded-full blur-2xl"></div>
            
            <div className="relative z-10 flex items-center gap-5">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-xl">
                <Heart className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-white">Patient Feedback</h1>
                <p className="text-blue-100 mt-1">Your opinion helps us improve care</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            {error && (
              <div className="bg-red-50 border-2 border-red-100 rounded-2xl p-5 mb-6 flex items-start gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-red-700">Error</p>
                  <p className="text-red-600">{error}</p>
                </div>
              </div>
            )}

<form onSubmit={handleSubmit} className="space-y-8">
              {currentPage === 1 && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 flex items-center gap-5 border border-blue-100">
                <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg">
                  {patientName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm text-gray-500 font-medium">Hello, welcome</p>
                  <p className="text-xl font-bold text-gray-800">{patientName}</p>
                </div>
              </div>
              )}

              {currentPage === 1 && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200">
                    <Star className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-800 text-xl">Rate Your Doctors</h3>
                    <p className="text-sm text-gray-500">Your ratings help us recognize excellence</p>
                  </div>
                </div>
                
                {doctors.map((d, idx) => (
                  <div key={d.id} className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-6 border-2 border-gray-100 hover:border-blue-200 transition-all">
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-400 via-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg">
                          {d.doctor_name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-gray-800 text-lg">{d.doctor_name}</p>
                          <p className="text-sm text-gray-500">Doctor #{idx + 1}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <StarRating
                        value={ratings[d.id]}
                        onChange={(next) => setRatings((prev) => ({ ...prev, [d.id]: next }))}
                        size="xl"
                      />
                    </div>
                    {ratings[d.id] && (
                      <p className="text-center text-base text-gray-500 mt-3 font-medium">
                        {ratings[d.id] === 5 && "🌟 Excellent! We're thrilled to hear this!"}
                        {ratings[d.id] === 4 && "👍 Very Good! Thank you for your positive feedback!"}
                        {ratings[d.id] === 3 && "📊 Good. We'll continue to improve."}
                        {ratings[d.id] === 2 && "📝 Fair. We value your honest input."}
                        {ratings[d.id] === 1 && "💡 We appreciate your feedback and will improve."}
                      </p>
)}
                  </div>
                ))}
              </div>
              )}

              {questions.length > 0 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-gradient-to-br from-violet-400 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg shadow-violet-200">
                      <ClipboardList className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800 text-xl">Survey Questions {totalPages > 1 ? `(Page ${currentPage} of ${totalPages})` : ''}</h3>
                      <p className="text-sm text-gray-500">Please answer the following</p>
                    </div>
                  </div>
                  
                  {questionsOnPage.map((q) => (
                    <div key={q.id} className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-6 border-2 border-gray-100">
                      <label className="block font-bold text-gray-800 text-lg mb-4 flex items-start gap-2">
                        <span className="text-blue-500 mt-1">Q.</span>
                        {q.label}
                        {q.required && <span className="text-red-400 mt-1">*</span>}
                      </label>
                      {renderQuestionInput(q)}
                    </div>
                  ))}

                  {totalPages > 1 && (
                    <div className="flex justify-center gap-4 mt-6">
                      {currentPage > 1 && (
                        <button
                          type="button"
                          onClick={() => setCurrentPage(currentPage - 1)}
                          className="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium flex items-center gap-2 transition-colors"
                        >
                          <ChevronLeft className="w-5 h-5" /> Previous
                        </button>
                      )}
                      {currentPage < totalPages && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!canGoNext()) {
                              setError('Please complete all required fields before moving to the next page.');
                              return;
                            }
                            setError('');
                            setCurrentPage(currentPage + 1);
                          }}
                          disabled={!canGoNext()}
                          className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:from-blue-600 hover:to-indigo-700 font-medium flex items-center gap-2 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Next <ChevronRight className="w-5 h-5" />
                        </button>
                      )}
                    </div>
)}
              </div>
              )}

              {currentPage === totalPages && (
              <div>
                <label className="block font-bold text-gray-800 text-lg mb-3 flex items-center gap-2">
                  <MessageCircle className="w-5 h-5 text-gray-400" />
                  Additional Comments
                  <span className="text-sm font-normal text-gray-500">(Optional)</span>
                </label>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Share any additional feedback or suggestions to help us serve you better..."
                  className="w-full p-5 border-2 border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 resize-none transition-all text-gray-700"
                  rows={4}
                />
              </div>
              )}

              {currentPage === totalPages && (
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white font-bold py-5 px-8 rounded-2xl hover:from-blue-700 hover:via-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-2xl shadow-blue-200 hover:shadow-3xl hover:shadow-blue-300 text-lg"
              >
                {submitting ? (
                  <>
                    <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-6 h-6" />
                    Submit Feedback
                  </>
                )}
              </button>
              )}

              {currentPage === totalPages && (
              <div className="flex items-center justify-center gap-3 text-sm text-gray-400">
                <Shield className="w-4 h-4" />
                <span>Your response is confidential and secure</span>
              </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard() {
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [message, setMessage] = React.useState({ type: '', text: '' });
  const [analytics, setAnalytics] = React.useState(null);
  const [responses, setResponses] = React.useState([]);
  const [questions, setQuestions] = React.useState([]);
  const [doctorsList, setDoctorsList] = React.useState([]);
  const adminKey = localStorage.getItem('admin_key') || '';

  const [filters, setFilters] = React.useState({ search: '', date_from: '', date_to: '' });
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const [loadingResponses, setLoadingResponses] = React.useState(false);
  const [pagination, setPagination] = React.useState({ page: 1, limit: 20, total: 0, total_pages: 0 });

  const [newQuestion, setNewQuestion] = React.useState({
    key: '',
    label: '',
    type: 'stars',
    required: true,
    options: [],
    min: 1,
    max: 5,
    page_number: 1
  });
  const [editingQuestion, setEditingQuestion] = React.useState(null);
  const [optionInput, setOptionInput] = React.useState('');
  const [deleteModal, setDeleteModal] = React.useState({ isOpen: false, question: null });
  const [responseDeleteModal, setResponseDeleteModal] = React.useState({ isOpen: false, ids: [], count: 0 });
  const [downloadDropdown, setDownloadDropdown] = React.useState(false);

  const showMessage = (text, type = 'info') => {
    if (type === 'error') toast.error(text);
    else if (type === 'success') toast.success(text);
    else toast.info(text);
  };

  function headers() {
    return adminKey ? { 'x-admin-key': adminKey } : {};
  }

  function formatAnswerValue(value) {
    if (Array.isArray(value)) return value.join(', ');
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  function formatDoctorNames(ratings) {
    const items = Array.isArray(ratings) ? ratings : [];
    if (!items.length) return '-';
    return items.map((x) => x.doctor_name).join(', ');
  }

  function formatDoctorRatings(ratings) {
    const items = Array.isArray(ratings) ? ratings : [];
    if (!items.length) return '-';
    return items.map((x) => `${x.doctor_name}: ${'★'.repeat(Number(x.rating))}`).join(' | ');
  }

  function getRatingBg(rating) {
    if (rating >= 4.5) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (rating >= 3.5) return 'bg-blue-100 text-blue-700 border-blue-200';
    if (rating >= 2.5) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-red-100 text-red-700 border-red-200';
  }

  async function loadAll(showNotif = true) {
    try {
      if (showNotif) showMessage('Loading...', 'info');

      const [aRes, rRes, qRes, dRes] = await Promise.all([
        fetch('/api/analytics', { headers: headers() }),
        fetch(`/api/responses?grouped=true&page=1&limit=20`, { headers: headers() }),
        fetch('/api/questions?all=true', { headers: headers() }),
        fetch('/api/doctors/list', { headers: headers() })
      ]);

      const [aData, rData, qData, dData] = await Promise.all([aRes.json(), rRes.json(), qRes.json(), dRes.json()]);

      if (!aRes.ok || aData.error) throw new Error(aData.error || 'Failed analytics');
      if (!rRes.ok || rData.error) throw new Error(rData.error || 'Failed responses');
      if (!qRes.ok || qData.error) throw new Error(qData.error || 'Failed questions');

      setAnalytics(aData);
      setResponses(rData.responses || []);
      setQuestions(qData.questions || []);
      if (dRes.ok && !dData.error) {
        const uniqueDoctors = [];
        const seen = new Set();
        for (const d of (dData.doctors || [])) {
          if (!seen.has(d.id)) {
            seen.add(d.id);
            uniqueDoctors.push(d);
}
    }
  }

  function deleteSelected() {
    openDeleteModal();
  }
      setPagination({
        page: rData.page || 1,
        limit: rData.limit || 20,
        total: rData.total || 0,
        total_pages: rData.total_pages || 0
      });

      setSelectedIds(new Set());
      if (showNotif) showMessage('Loaded successfully', 'success');
    } catch (err) {
      if (showNotif) showMessage('Load failed: ' + err.message, 'error');
    }
  }

  async function fetchResponsesWithFilters(pageOverride, currentFilters) {
    setLoadingResponses(true);
    try {
      const params = new URLSearchParams({ grouped: 'true' });
      if (currentFilters.search) params.set('search', currentFilters.search);
      if (currentFilters.date_from) params.set('date_from', currentFilters.date_from);
      if (currentFilters.date_to) params.set('date_to', currentFilters.date_to);
      params.set('page', pageOverride);
      params.set('limit', pagination.limit);

      const res = await fetch('/api/responses?' + params.toString(), { headers: headers() });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed');

      setResponses(data.responses || []);
      setPagination((p) => ({
        page: data.page || 1,
        limit: data.limit || p.limit,
        total: data.total || 0,
        total_pages: data.total_pages || 0
      }));
    } catch (err) {
      showMessage('Load failed: ' + err.message, 'error');
    } finally {
      setLoadingResponses(false);
    }
  }

  function changePage(newPage) {
    if (newPage < 1 || newPage > pagination.total_pages) return;
    fetchResponsesWithFilters(newPage, filters);
  }

  function handleFilterChange(newFilters) {
    setFilters(newFilters);
    setPagination((p) => ({ ...p, page: 1 }));
    setSelectedIds(new Set());
    fetchResponsesWithFilters(1, newFilters);
  }

  React.useEffect(() => {
    loadAll(false);
  }, []);

  React.useEffect(() => {
    if (activeTab === 'responses') {
      fetchResponsesWithFilters(pagination.page, filters);
    }
  }, [activeTab]);

  function setType(type) {
    setNewQuestion((prev) => ({
      ...prev,
      type,
      options: type === 'single_choice' || type === 'multi_choice' ? prev.options : [],
      min: type === 'stars' ? 1 : prev.min,
      max: type === 'stars' ? 5 : prev.max
    }));
  }

  function addOption() {
    const opt = optionInput.trim();
    if (!opt) return;
    setNewQuestion((prev) => {
      if (prev.options.includes(opt)) return prev;
      return { ...prev, options: [...prev.options, opt] };
    });
    setOptionInput('');
  }

  function removeOption(value) {
    setNewQuestion((prev) => ({ ...prev, options: prev.options.filter((x) => x !== value) }));
  }

  async function createQuestion(e) {
    e.preventDefault();
    try {
      if (!newQuestion.label.trim()) throw new Error('Question label is required');
      if ((newQuestion.type === 'single_choice' || newQuestion.type === 'multi_choice') && newQuestion.options.length === 0) {
        throw new Error('Add at least one option for choice question');
      }

      const payload = {
        key: newQuestion.key,
        label: newQuestion.label,
        type: newQuestion.type,
        required: newQuestion.required,
        options: newQuestion.options,
        min: newQuestion.min,
        max: newQuestion.max,
        page_number: newQuestion.page_number || 1
      };

      let res, data;
      if (editingQuestion) {
        res = await fetch('/api/questions/' + editingQuestion.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...headers() },
          body: JSON.stringify(payload)
        });
        data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Question update failed');
        setEditingQuestion(null);
        showMessage('Question updated successfully', 'success');
      } else {
        res = await fetch('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers() },
          body: JSON.stringify(payload)
        });
        data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Question create failed');
        showMessage('Question created successfully', 'success');
      }

      setNewQuestion({ key: '', label: '', type: 'stars', required: true, options: [], min: 1, max: 5, page_number: 1 });
      setOptionInput('');
      await loadAll(false);
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  function editQuestion(q) {
    setEditingQuestion(q);
    setNewQuestion({
      key: q.key || '',
      label: q.label || '',
      type: q.type || 'stars',
      required: q.required !== undefined ? q.required : true,
      options: q.options || [],
      min: q.min_value || 1,
      max: q.max_value || 5,
      page_number: q.page_number || 1
    });
    setOptionInput('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingQuestion(null);
    setNewQuestion({ key: '', label: '', type: 'stars', required: true, options: [], min: 1, max: 5, page_number: 1 });
    setOptionInput('');
  }

  async function toggleQuestionActive(q) {
    try {
      const res = await fetch('/api/questions/' + q.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ is_active: !q.is_active })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Question update failed');
      await loadAll(false);
      showMessage(q.is_active ? 'Question disabled' : 'Question enabled', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  async function deleteQuestion(q) {
    setDeleteModal({ isOpen: true, question: q });
  }

  async function confirmDeleteQuestion() {
    if (!deleteModal.question) return;
    try {
      const res = await fetch('/api/questions/' + deleteModal.question.id, {
        method: 'DELETE',
        headers: headers()
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Question delete failed');
      setDeleteModal({ isOpen: false, question: null });
      await loadAll(false);
      showMessage('Question deleted', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
      setDeleteModal({ isOpen: false, question: null });
    }
  }

  async function moveQuestion(questionId, direction) {
    const question = questions.find((x) => x.id === questionId);
    if (!question) return;
    
    const samePageQuestions = questions.filter((q) => (q.page_number || 1) === (question.page_number || 1));
    const idx = samePageQuestions.findIndex((x) => x.id === questionId);
    if (idx < 0) return;

    const next = [...samePageQuestions];
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= next.length) return;

    const temp = next[idx];
    next[idx] = next[swapWith];
    next[swapWith] = temp;

    const ids = next.map((q) => q.id);
    const res = await fetch('/api/questions/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ ids })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Reorder failed');

    await loadAll(false);
  }

  function getExportData(data) {
    return data.map((r) => {
      const row = {
        'Submission ID': r.submission_id,
        'Submitted At': r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '',
        'Visit ID': r.visit_id,
        'Patient Name': r.patient_name,
        'Doctor Names': formatDoctorNames(r.ratings),
        'Doctor Ratings': formatDoctorRatings(r.ratings),
        'Comment': r.comment || ''
      };
      questions.forEach((q) => {
        row[q.label] = formatAnswerValue((r.question_answers || {})[q.key]);
      });
      return row;
    });
  }

  function exportToCSV(data) {
    const rows = getExportData(data);
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => {
        const val = String(r[h] || '').replace(/"/g, '""');
        return '"' + val + '"';
      }).join(','))
    ].join('\n');
    downloadFile(csv, 'responses.csv', 'text/csv');
  }

  function exportSelectedToCSV() {
    const selectedData = responses.filter((r) => selectedIds.has(r.submission_id));
    if (selectedData.length === 0) {
      showMessage('No responses selected', 'error');
      return;
    }
    const rows = getExportData(selectedData);
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => {
        const val = String(r[h] || '').replace(/"/g, '""');
        return '"' + val + '"';
      }).join(','))
    ].join('\n');
    downloadFile(csv, `responses_selected_${selectedIds.size}.csv`, 'text/csv');
    showMessage(`Downloaded ${selectedIds.size} responses as CSV`, 'success');
  }

  function exportSelectedToExcel() {
    const selectedData = responses.filter((r) => selectedIds.has(r.submission_id));
    if (selectedData.length === 0) {
      showMessage('No responses selected', 'error');
      return;
    }
    const rows = getExportData(selectedData);
    if (rows.length === 0) return;
    
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Responses');
    XLSX.writeFile(wb, `responses_selected_${selectedIds.size}.xlsx`);
    showMessage(`Downloaded ${selectedIds.size} responses as Excel`, 'success');
  }

  function exportToExcel() {
    if (responses.length === 0) {
      showMessage('No responses to export', 'error');
      return;
    }
    const rows = getExportData(responses);
    if (rows.length === 0) return;
    
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Responses');
    XLSX.writeFile(wb, 'all_responses.xlsx');
    showMessage(`Downloaded ${responses.length} responses as Excel`, 'success');
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function toggleSelectAll() {
    if (selectedIds.size === responses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(responses.map((r) => r.submission_id)));
    }
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function openDeleteModal() {
    if (selectedIds.size === 0) return;
    setResponseDeleteModal({ isOpen: true, ids: Array.from(selectedIds), count: selectedIds.size });
  }

  async function confirmDeleteResponses() {
    if (responseDeleteModal.ids.length === 0) return;
    try {
      const res = await fetch('/api/responses', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ ids: responseDeleteModal.ids })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Delete failed');
      setResponseDeleteModal({ isOpen: false, ids: [], count: 0 });
      setSelectedIds(new Set());
      await fetchResponsesWithFilters(1, filters);
      showMessage('Deleted ' + data.deleted + ' response(s)', 'success');
    } catch (err) {
      showMessage('Delete failed: ' + err.message, 'error');
      setResponseDeleteModal({ isOpen: false, ids: [], count: 0 });
    }
  }

  function deleteSelected() {
    openDeleteModal();
  }

  function clearFilters() {
    setFilters({ search: '', date_from: '', date_to: '' });
    handleFilterChange({ search: '', date_from: '', date_to: '' });
  }

  const allSelected = responses.length > 0 && selectedIds.size === responses.length;
  const someSelected = selectedIds.size > 0;

  const questionTypeCards = [
    { id: 'stars', label: 'Stars', icon: '★' },
    { id: 'text', label: 'Text', icon: 'T' },
    { id: 'single_choice', label: 'Single', icon: '1' },
    { id: 'multi_choice', label: 'Multi', icon: '∞' },
    { id: 'number', label: 'Number', icon: '#' },
    { id: 'yes_no', label: 'Yes/No', icon: '?' }
  ];

  const isChoice = newQuestion.type === 'single_choice' || newQuestion.type === 'multi_choice';
  const isRanged = newQuestion.type === 'stars' || newQuestion.type === 'number';

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'questions', label: 'Questions', icon: FileText },
    { id: 'responses', label: 'Responses', icon: MessageSquare }
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-gradient-to-b from-slate-800 via-slate-800 to-slate-900 text-white flex flex-col fixed h-full">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <span>Feedback Admin</span>
              <p className="text-xs text-slate-400 font-normal">Patient Survey</p>
            </div>
          </h1>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all ${
                activeTab === item.id
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-600 font-semibold shadow-lg shadow-blue-500/30'
                  : 'hover:bg-white/10'
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
              {activeTab === item.id && <ChevronRight className="w-4 h-4 ml-auto" />}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <button
            onClick={() => window.location.reload()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-white/10 transition-all text-slate-300 hover:text-white"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh Data
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-64 p-8 overflow-hidden">
        {message.text && (
          <div className={`mb-6 p-4 rounded-xl flex items-center gap-3 animate-fade-in ${
            message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            {message.type === 'error' && <AlertCircle className="w-5 h-5" />}
            {message.type === 'success' && <Check className="w-5 h-5" />}
            {message.type === 'info' && <Activity className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="space-y-8 animate-fade-in">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
              <p className="text-gray-500">Overview of your patient feedback system</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
                    <MessageSquare className="w-7 h-7 text-white" />
                  </div>
                  <TrendingUp className="w-6 h-6 text-emerald-500" />
                </div>
                <p className="text-gray-500 text-sm font-medium">Total Submissions</p>
                <p className="text-4xl font-bold text-gray-800 mt-1">{analytics?.total_submissions || 0}</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-400 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-purple-200">
                    <Users className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-purple-100 text-purple-600 rounded-full font-medium">Doctors</span>
                </div>
                <p className="text-gray-500 text-sm font-medium">Doctors Rated</p>
                <p className="text-4xl font-bold text-gray-800 mt-1">{analytics?.doctor_averages?.length || 0}</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-200">
                    <FileText className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-emerald-100 text-emerald-600 rounded-full font-medium">Questions</span>
                </div>
                <p className="text-gray-500 text-sm font-medium">Survey Questions</p>
                <p className="text-4xl font-bold text-gray-800 mt-1">{questions.length + 1}</p>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-200">
                    <Star className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-amber-100 text-amber-600 rounded-full font-medium">Avg</span>
                </div>
                <p className="text-gray-500 text-sm font-medium">Average Rating</p>
                <p className="text-4xl font-bold text-gray-800 mt-1">
                  {analytics?.doctor_averages?.length > 0
                    ? (analytics.doctor_averages.reduce((sum, d) => sum + Number(d.avg_rating), 0) / analytics.doctor_averages.length).toFixed(1)
                    : '0.0'}
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
                    <BarChart3 className="w-4 h-4 text-blue-600" />
                  </div>
                  Doctor Performance
                </h3>
              </div>

              {analytics?.doctor_averages?.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analytics.doctor_averages.map((doctor) => {
                    const rating = Number(doctor.avg_rating || 0);
                    const percentage = (rating / 5) * 100;
                    return (
                      <div key={doctor.doctor_id} className="bg-gradient-to-br from-gray-50 to-white rounded-2xl p-5 border border-gray-100">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                              {doctor.doctor_name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800">{doctor.doctor_name}</p>
                              <p className="text-sm text-gray-500">{doctor.rating_count} ratings</p>
                            </div>
                          </div>
                          <div className={`px-4 py-2 rounded-xl text-sm font-bold border ${getRatingBg(rating)}`}>
                            {rating.toFixed(1)} / 5
                          </div>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              rating >= 4.5 ? 'bg-gradient-to-r from-emerald-400 to-emerald-500' :
                              rating >= 3.5 ? 'bg-gradient-to-r from-blue-400 to-indigo-500' :
                              rating >= 2.5 ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-red-400 to-red-500'
                            }`}
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="flex mt-3">
                          <StarRating value={rating} size="sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-16 bg-gradient-to-br from-gray-50 to-white rounded-2xl border-2 border-dashed border-gray-200">
                  <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p className="text-gray-500 font-medium">No ratings yet</p>
                  <p className="text-sm text-gray-400">Complete surveys to see analytics</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'questions' && (
          <div className="space-y-6 animate-fade-in">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">Question Manager</h2>
              <p className="text-gray-500">Create and manage survey questions</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${editingQuestion ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                    {editingQuestion ? <Edit3 className="w-4 h-4 text-amber-600" /> : <Plus className="w-4 h-4 text-emerald-600" />}
                  </div>
                  {editingQuestion ? 'Edit Question' : 'Create New Question'}
                </h3>

                <form onSubmit={createQuestion} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Question Label</label>
                    <input
                      type="text"
                      value={newQuestion.label}
                      onChange={(e) => setNewQuestion((p) => ({ ...p, label: e.target.value }))}
                      placeholder="e.g., How was your experience?"
                      className="w-full p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Question Key (optional)</label>
                    <input
                      type="text"
                      value={newQuestion.key}
                      onChange={(e) => setNewQuestion((p) => ({ ...p, key: e.target.value }))}
                      placeholder="e.g., experience_rating"
                      className="w-full p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Question Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {questionTypeCards.map((typeItem) => (
                        <button
                          key={typeItem.id}
                          type="button"
                          onClick={() => setType(typeItem.id)}
                          className={`p-3 rounded-xl font-medium transition-all flex flex-col items-center gap-1 ${
                            newQuestion.type === typeItem.id
                              ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-200'
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100 border-2 border-gray-100'
                          }`}
                        >
                          <span className="text-lg">{typeItem.icon}</span>
                          <span className="text-xs">{typeItem.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="required"
                      checked={newQuestion.required}
                      onChange={(e) => setNewQuestion((p) => ({ ...p, required: e.target.checked }))}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <label htmlFor="required" className="text-sm text-gray-700">Required question</label>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Survey Page Number</label>
                    <input
                      type="number"
                      min="1"
                      value={newQuestion.page_number}
                      onChange={(e) => setNewQuestion((p) => ({ ...p, page_number: e.target.value === '' ? 1 : Number(e.target.value) }))}
                      className="w-full p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 transition-all"
                    />
                    <p className="text-xs text-gray-500 mt-1">Questions will be grouped by page number in the survey</p>
                  </div>

                  {isChoice && (
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-gray-700">Options</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={optionInput}
                          onChange={(e) => setOptionInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addOption(); }
                          }}
                          placeholder="Add option..."
                          className="flex-1 p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200"
                        />
                        <button type="button" onClick={addOption} className="px-4 py-3 bg-gray-100 rounded-xl hover:bg-gray-200 font-medium">
                          <Plus className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {newQuestion.options.map((opt) => (
                          <button key={opt} type="button" onClick={() => removeOption(opt)} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-sm font-medium flex items-center gap-1.5 hover:bg-blue-100 transition-colors">
                            {opt} <X className="w-4 h-4" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {isRanged && (
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Min Value</label>
                        <input type="number" value={newQuestion.min} onChange={(e) => setNewQuestion((p) => ({ ...p, min: e.target.value === '' ? '' : Number(e.target.value) }))} className="w-full p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Max Value</label>
                        <input type="number" value={newQuestion.max} onChange={(e) => setNewQuestion((p) => ({ ...p, max: e.target.value === '' ? '' : Number(e.target.value) }))} className="w-full p-3 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200" />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {editingQuestion && (
                      <button type="button" onClick={cancelEdit} className="flex-1 bg-gray-100 text-gray-700 font-bold py-3 px-6 rounded-xl hover:bg-gray-200 transition-all flex items-center justify-center gap-2">
                        <X className="w-5 h-5" /> Cancel
                      </button>
                    )}
                    <button type="submit" className={`flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 px-6 rounded-xl hover:from-emerald-600 hover:to-teal-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-200`}>
                      {editingQuestion ? <><Check className="w-5 h-5" /> Update Question</> : <><Plus className="w-5 h-5" /> Create Question</>}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
                    <FileText className="w-4 h-4 text-blue-600" />
                  </div>
                  Survey Questions ({questions.length + 1})
                </h3>

                <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-2xl p-4">
                    <span className="inline-block px-2.5 py-1 bg-blue-500 text-white rounded-lg text-xs font-bold mb-2">FIXED</span>
                    <p className="font-semibold text-gray-800">How do you rate the doctor who treats you?</p>
                    <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                      <span className="px-2 py-0.5 bg-blue-100 rounded font-medium">★ Stars</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">Required</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">Active</span>
                    </div>
                  </div>

                  {questions.map((q, idx) => (
                    <div key={q.id} className={`rounded-2xl p-4 border-2 transition-all ${q.is_active ? 'bg-gray-50 border-gray-200 hover:border-blue-200' : 'bg-gray-100 border-gray-300 opacity-70'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-gray-500">#{idx + 2}</span>
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${q.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                              {q.is_active ? 'Active' : 'Inactive'}
                            </span>
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium">{q.type}</span>
                            {q.required && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-lg text-xs font-medium">Required</span>}
                          </div>
                          <p className="font-semibold text-gray-800">{q.label}</p>
                          <p className="text-sm text-gray-500 mt-1">Key: {q.key}</p>
                          {q.options?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {q.options.map((opt) => (<span key={opt} className="px-2.5 py-1 bg-gray-200 text-gray-700 rounded-lg text-xs font-medium">{opt}</span>))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <button onClick={() => moveQuestion(q.id, -1)} className="p-2 hover:bg-gray-200 rounded-xl transition-colors" title="Move"><ArrowUpDown className="w-4 h-4 text-gray-600" /></button>
                          <button onClick={() => editQuestion(q)} className="p-2 hover:bg-blue-100 rounded-xl transition-colors text-blue-600" title="Edit"><Edit3 className="w-4 h-4" /></button>
                          <button onClick={() => toggleQuestionActive(q)} className={`p-2 rounded-xl transition-colors ${q.is_active ? 'hover:bg-red-100 text-red-600' : 'hover:bg-emerald-100 text-emerald-600'}`} title={q.is_active ? 'Disable' : 'Enable'}>
                            {q.is_active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button onClick={() => deleteQuestion(q)} className="p-2 hover:bg-red-100 rounded-xl transition-colors text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'responses' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-800">Responses</h2>
                <p className="text-gray-500">View and manage patient feedback submissions</p>
              </div>
              <div className="relative">
                <button 
                  onClick={() => setDownloadDropdown(!downloadDropdown)} 
                  disabled={responses.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-200"
                >
                  <Download className="w-5 h-5" /> Export <ChevronDown className="w-4 h-4" />
                </button>
                {downloadDropdown && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
                    <button 
                      onClick={() => { exportToCSV(responses); setDownloadDropdown(false); }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700 transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-emerald-500" /> Download as CSV
                    </button>
                    <button 
                      onClick={() => { exportToExcel(); setDownloadDropdown(false); }}
                      className="w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700 transition-colors"
                    >
                      <FileSpreadsheet className="w-5 h-5 text-green-500" /> Download as Excel
                    </button>
                  </div>
                )}
              </div>
              {downloadDropdown && <div className="fixed inset-0 z-40" onClick={() => setDownloadDropdown(false)}></div>}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
              <div className="p-5 border-b border-gray-100">
                <div className="flex flex-wrap gap-3">
                  <div className="flex-1 min-w-[200px] max-w-[400px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input type="text" placeholder="Search patient name or doctor name..." value={filters.search} onChange={(e) => handleFilterChange({ ...filters, search: e.target.value })} className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-200 text-sm transition-all" />
                    </div>
                  </div>
                  <input type="date" value={filters.date_from} onChange={(e) => handleFilterChange({ ...filters, date_from: e.target.value })} className="px-4 py-2.5 border-2 border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                  <input type="date" value={filters.date_to} onChange={(e) => handleFilterChange({ ...filters, date_to: e.target.value })} className="px-4 py-2.5 border-2 border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500" />
                  <button onClick={clearFilters} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 font-medium flex items-center gap-2 text-sm transition-colors">
                    <Filter className="w-4 h-4" /> Clear
                  </button>
                </div>
              </div>

              {someSelected && (
                <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 flex items-center justify-between">
                  <span className="font-semibold text-blue-700 flex items-center gap-2"><Check className="w-4 h-4" /> {selectedIds.size} responses selected</span>
                  <div className="flex items-center gap-3">
                    <button onClick={toggleSelectAll} className="px-3 py-1.5 text-blue-600 hover:text-blue-800 font-medium text-sm">{allSelected ? 'Deselect All' : 'Select All'}</button>
                    <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 text-gray-600 hover:text-gray-800 font-medium text-sm">Clear</button>
                    <div className="relative group">
                      <button className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 font-medium flex items-center gap-1.5 text-sm">
                        <Download className="w-4 h-4" /> Download <ChevronDown className="w-3 h-3" />
                      </button>
                      <div className="absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                        <button onClick={() => exportSelectedToCSV()} className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Download CSV
                        </button>
                        <button onClick={() => exportSelectedToExcel()} className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 text-sm text-gray-700 border-t border-gray-100">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> Download Excel
                        </button>
                      </div>
                    </div>
                    <button onClick={deleteSelected} className="px-4 py-1.5 bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium flex items-center gap-1.5 text-sm">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1200px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left w-12">
                        <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected; }} onChange={toggleSelectAll} className="w-4 h-4 text-blue-600 rounded cursor-pointer" />
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">Submitted</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">Visit</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">Patient</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">Doctors</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">Rating</th>
                      {questions.map((q) => (<th key={q.id} className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap min-w-[150px]">{q.label}</th>))}
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap min-w-[200px]">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingResponses ? (
                      <tr><td colSpan={8 + questions.length} className="px-4 py-16 text-center"><div className="flex items-center justify-center"><div className="w-10 h-10 border-4 border-blue-100 border-t-blue-500 rounded-full animate-spin"></div></div></td></tr>
                    ) : responses.length === 0 ? (
                      <tr><td colSpan={8 + questions.length} className="px-4 py-12 text-center text-gray-500">No responses found</td></tr>
                    ) : (
                      responses.map((r) => (
                        <tr key={r.submission_id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${selectedIds.has(r.submission_id) ? 'bg-blue-50' : ''}`}>
                          <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.has(r.submission_id)} onChange={() => toggleSelect(r.submission_id)} className="w-4 h-4 text-blue-600 rounded cursor-pointer" /></td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 font-mono whitespace-nowrap">{r.visit_id}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-800 whitespace-nowrap">{r.patient_name}</td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{formatDoctorNames(r.ratings)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-1">
                              {(r.ratings || []).map((rating) => (
                                <div key={rating.doctor_id} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-500 max-w-[100px] truncate">{rating.doctor_name}</span>
                                  <StarRating value={rating.rating} size="sm" />
                                </div>
                              ))}
                            </div>
                          </td>
                          {questions.map((q) => (<td key={q.id} className="px-4 py-3 text-sm text-gray-700 whitespace-normal max-w-[200px]"><span className="line-clamp-2">{formatAnswerValue((r.question_answers || {})[q.key])}</span></td>))}
                          <td className="px-4 py-3 text-sm text-gray-700 max-w-[250px]"><span className="line-clamp-2">{r.comment || '-'}</span></td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
                <p className="text-sm text-gray-500">Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)} - {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}</p>
                <div className="flex items-center gap-2">
                  <select value={pagination.limit} onChange={(e) => { setPagination((p) => ({ ...p, limit: Number(e.target.value), page: 1 })); fetchResponsesWithFilters(1, filters); }} className="px-3 py-2 border-2 border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 bg-white">
                    <option value={10}>10 / page</option>
                    <option value={20}>20 / page</option>
                    <option value={50}>50 / page</option>
                    <option value={100}>100 / page</option>
                  </select>
                  <button onClick={() => changePage(pagination.page - 1)} disabled={pagination.page <= 1} className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ChevronLeft className="w-5 h-5" /></button>
                  <span className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-semibold text-sm">{pagination.page} / {pagination.total_pages || 1}</span>
                  <button onClick={() => changePage(pagination.page + 1)} disabled={pagination.page >= pagination.total_pages} className="p-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"><ChevronRight className="w-5 h-5" /></button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <DeleteModal
        isOpen={deleteModal.isOpen}
        onClose={() => setDeleteModal({ isOpen: false, question: null })}
        onConfirm={confirmDeleteQuestion}
        title="Delete Question"
        message={`Are you sure you want to delete "${deleteModal.question?.label}"? This action cannot be undone.`}
        type="danger"
      />
      <DeleteModal
        isOpen={responseDeleteModal.isOpen}
        onClose={() => setResponseDeleteModal({ isOpen: false, ids: [], count: 0 })}
        onConfirm={confirmDeleteResponses}
        title="Delete Responses"
        message={`Are you sure you want to delete ${responseDeleteModal.count} response(s)? This action cannot be undone.`}
        type="danger"
      />
    </div>
  );
}

function DeleteModal({ isOpen, onClose, onConfirm, title, message, type = 'danger' }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden animate-modal shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-red-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
          <p className="text-gray-500 mb-6">{message}</p>
          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="flex-1 px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={onConfirm}
              className="flex-1 px-6 py-3 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white font-semibold rounded-xl transition-all shadow-lg"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
